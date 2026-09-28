# Muirgen – Raspberry Pi 5 Install Guide (AlmaLinux 10)

Sep 27, 2026 · @Madison

## Overview and assumptions

This guide builds the `muirgen-mf` server on a Raspberry Pi 5 (8 GB, aarch64) from a fresh AlmaLinux 10 minimal install. All commands run as `root` unless noted.

- **Hardware:** Raspberry Pi 5, 8 GB RAM, boot from SD card, NVMe drive formatted XFS and mounted at `/mnt/nvme`.
- **Database stack:** PostgreSQL 18 (PGDG), PostGIS 3.6 (PGDG), TimescaleDB built from source.
- **Why PostgreSQL 18:** the schema uses `uuidv7()` as a column default, which is new in PG18.
- **Why TimescaleDB is built from source:** Timescale's own RPM repo only publishes x86\_64. PGDG ships an aarch64 `timescaledb_18`, but it is the Apache-only edition. Muirgen needs the Timescale License features: `timescaledb.compress`, `add_compression_policy()` and `add_retention_policy()` on every hypertable.
- **Why the data lives on NVMe:** constant telemetry writes would wear out the SD card, and NVMe is far faster.

## 1. Base OS prep

Enable CRB and EPEL first, because several PostgreSQL and PostGIS dependencies (for example `perl-IPC-Run`, `libicu-devel`, GDAL libraries) come from them. RPM Fusion supplies the encumbered media tools (`ffmpeg`, `libheif-freeworld`) used for uploads.

```bash
dnf install -y dnf-plugins-core epel-release
dnf config-manager --set-enabled crb

dnf install -y https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-10.noarch.rpm \
               https://mirrors.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-10.noarch.rpm

dnf install -y libheif libheif-freeworld ffmpeg rsync vim bash-completion policycoreutils-python-utils
dnf update -y
```

Confirm the architecture before going further: `uname -m` must print `aarch64`.

## 2. NVMe mount

Mount the NVMe by UUID with `noatime`. Without `noatime`, every read also writes an access-time update, which is wasted I/O for a database.

```bash
blkid /dev/nvme0n1p1          # note the UUID
mkdir -p /mnt/nvme
echo 'UUID=<your-uuid> /mnt/nvme xfs defaults,noatime 0 0' >> /etc/fstab
systemctl daemon-reload
mount /mnt/nvme
findmnt /mnt/nvme             # OPTIONS should include noatime
```

If the entry already exists with `defaults`, change it in place instead:

```bash
sed -i 's|/mnt/nvme xfs defaults|/mnt/nvme xfs defaults,noatime|' /etc/fstab
systemctl daemon-reload
mount -o remount,noatime /mnt/nvme
```

### 2.1 Persistent journal on the NVMe

Keep system logs across reboots without wearing out the SD card. The trick is a **bind mount**: `/mnt/nvme/journal` appears at `/var/log/journal`, so journald writes to the NVMe without any other change.

- **Early boot:** journald logs to RAM (`/run/log/journal`) until the NVMe is mounted. `systemd-journal-flush.service` then moves those logs to disk, so nothing is lost.
- **`x-systemd.requires-mounts-for=/mnt/nvme`:** the bind mount waits for the NVMe and never binds an empty directory.
- **`semanage fcontext -e`:** the NVMe directory is labelled like `/var/log/journal` (`var_log_t`), permanently.
- **`SystemMaxUse=2G`:** journald removes the oldest logs once the cap is reached.

```bash
mkdir -p /mnt/nvme/journal /var/log/journal
semanage fcontext -a -e /var/log/journal /mnt/nvme/journal
restorecon -Rv /mnt/nvme/journal

echo '/mnt/nvme/journal /var/log/journal none bind,x-systemd.requires-mounts-for=/mnt/nvme 0 0' >> /etc/fstab
systemctl daemon-reload
mount /var/log/journal
findmnt /var/log/journal          # SOURCE: /dev/nvme0n1p1[/journal]

mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/muirgen.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=2G
EOF

systemd-tmpfiles --create --prefix /var/log/journal
systemctl restart systemd-journald
journalctl --flush
journalctl --disk-usage
```

Afterwards, `journalctl -b -1` shows the previous boot. For example, `journalctl -k -b -1 | grep -i voltage` shows whether the Pi browned out.

Optional: `systemctl disable --now rsyslog` stops the duplicate copy of every log line going to `/var/log/messages` on the SD card.

## 3. PGDG repo, PostgreSQL 18 and PostGIS

Install the PGDG repo package for **EL-10-aarch64**. On first `makecache`, dnf asks to import the `PGDG-RPM-GPG-KEY-AARCH64-RHEL` key (fingerprint `B031 F89F C983 E982 6290 6B6E 177B 343B B973 8825`); answer `y`. EL10 has no dnf modules, so the `dnf module disable postgresql` step from older guides is not needed.

```bash
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-aarch64/pgdg-redhat-repo-latest.noarch.rpm

# Only PG18 is needed
dnf config-manager --set-disabled pgdg14 pgdg15 pgdg16 pgdg17

# Block PGDG's Apache-only TimescaleDB so it never overwrites the source build
dnf config-manager --save --setopt=pgdg18.exclude='timescaledb_*'

dnf clean all && dnf makecache

dnf install -y postgresql18-server postgresql18-contrib postgresql18-devel \
               postgis36_18 postgis36_18-utils
```

`postgresql18-devel` provides `pg_config` and the headers needed to compile TimescaleDB.

If the PGDG repo package is ever upgraded, dnf leaves a `pgdg-redhat-all.repo.rpmnew` beside the old file. Replace the old file with it (`mv -f pgdg-redhat-all.repo.rpmnew pgdg-redhat-all.repo`), then re-run the disable and exclude commands above.

## 4. PostgreSQL data directory on the NVMe

The cluster lives at `/mnt/nvme/pgsql/18/data`. Three things make that work on an SELinux-enforcing system.

1. **Ownership and mode.** PostgreSQL refuses to start unless its data directory is owned by `postgres` with mode `0700`.
2. **SELinux label.** The service runs in the `postgresql_t` domain, which may only touch files labelled `postgresql_db_t`. `semanage fcontext` records the rule permanently; `restorecon` applies it now.
3. **systemd drop-in.** It sets `PGDATA` for the unit. `RequiresMountsFor` makes PostgreSQL wait for the NVMe, so it never initializes or starts against an empty mount point.

```bash
mkdir -p /mnt/nvme/pgsql/18/data
chown -R postgres:postgres /mnt/nvme/pgsql
chmod 700 /mnt/nvme/pgsql/18/data

semanage fcontext -a -t postgresql_db_t "/mnt/nvme/pgsql(/.*)?"
restorecon -Rv /mnt/nvme/pgsql

mkdir -p /etc/systemd/system/postgresql-18.service.d
cat > /etc/systemd/system/postgresql-18.service.d/override.conf <<'EOF'
[Unit]
RequiresMountsFor=/mnt/nvme

[Service]
Environment=PGDATA=/mnt/nvme/pgsql/18/data
EOF
systemctl daemon-reload

# initdb reads PGDATA from the unit, so the cluster lands on the NVMe
/usr/pgsql-18/bin/postgresql-18-setup initdb

# Make 'su - postgres' tools (psql, pg_ctl) use the same path
sed -i 's|^PGDATA=.*|PGDATA=/mnt/nvme/pgsql/18/data|' /var/lib/pgsql/.bash_profile

systemctl enable --now postgresql-18
sudo -u postgres psql -c "SHOW data_directory;" -c "SELECT version();"
```

Expected: `data_directory` is `/mnt/nvme/pgsql/18/data` and the version line says `aarch64`.

## 5. Build TimescaleDB from source

Pick the version first:

- **Migrating data from another server:** build the **same version** the source runs (`SELECT extversion FROM pg_extension WHERE extname='timescaledb';`). The VM ran **2.24.0**. Upgrade after the restore (section 9).
- **Fresh install:** build the latest release tag.

```bash
dnf install -y git gcc make cmake openssl-devel krb5-devel redhat-rpm-config

TSDB_VER=2.24.0        # set to the version you need
mkdir -p /usr/local/src && cd /usr/local/src
git clone --branch ${TSDB_VER} --depth 1 https://github.com/timescale/timescaledb.git timescaledb-${TSDB_VER}
cd timescaledb-${TSDB_VER}

./bootstrap -DCMAKE_BUILD_TYPE=Release \
            -DPG_CONFIG=/usr/pgsql-18/bin/pg_config \
            -DREGRESS_CHECKS=OFF -DTAP_CHECKS=OFF \
            -DWARNINGS_AS_ERRORS=OFF
cd build
make -j4
make install
restorecon -Rv /usr/pgsql-18/lib /usr/pgsql-18/share/extension
```

During `bootstrap`, `CC_PCLMUL - Failed` and `UMASH_SUPPORTED - Failed` are expected on ARM. PCLMUL is an x86-only CPU instruction that TimescaleDB's fast UMASH hash relies on, so on aarch64 it falls back to a portable hash. Everything still works. Only some vectorized grouping on compressed data is slightly slower.

What the flags do:

- `PG_CONFIG` tells CMake which PostgreSQL to build against, which matters if more than one is ever installed.
- `REGRESS_CHECKS` / `TAP_CHECKS` off skip test-suite dependencies (such as `pg_regress` and Perl test modules) that aren't needed to run the extension.
- `WARNINGS_AS_ERRORS` off prevents a newer compiler's extra warnings (GCC 14 here) from failing the build.
- No `-DAPACHE_ONLY` means the Timescale License code (compression, policies) is included.

Verify the install. There should be a loader (`timescaledb.so`) plus versioned libraries:

```bash
ls /usr/pgsql-18/lib/timescaledb*.so
# timescaledb.so  timescaledb-2.24.0.so  timescaledb-tsl-2.24.0.so
```

The loader is what `shared_preload_libraries` loads. It then loads whichever versioned library each database's extension version asks for. That is why several versions can be installed side by side, and why upgrades are just "build the new version, then `ALTER EXTENSION`".

`dnf update` will never touch this build. Rebuild it yourself when you want a new version.

## 6. PostgreSQL configuration

Muirgen's settings go in their own file, `conf.d/muirgen.conf`, instead of edits scattered through the stock `postgresql.conf`. That keeps the stock file untouched and makes the settings easy to copy to a new install. Settings read later override earlier ones, so an `include_dir` at the end of `postgresql.conf` wins.

```bash
cd /mnt/nvme/pgsql/18/data
sudo -u postgres mkdir -p conf.d
echo "include_dir = 'conf.d'" >> postgresql.conf

cat > conf.d/muirgen.conf <<'EOF'
# --- Connections ---
listen_addresses = 'localhost'      # section 8.3 adds the LAN address for n2k-ingest

# --- TimescaleDB ---
shared_preload_libraries = 'timescaledb'
timescaledb.license = 'timescale'   # enables compression and policies
timescaledb.telemetry_level = off   # boat is often offline; no phoning home
timescaledb.max_background_workers = 16

# --- Workers (Pi 5 has 4 cores) ---
max_worker_processes = 24           # >= TSDB workers + parallel workers + spare
max_parallel_workers = 4
max_parallel_workers_per_gather = 2

# --- Memory (8 GB RAM) ---
shared_buffers = 2GB                # ~25% of RAM
effective_cache_size = 5GB          # planner hint: shared_buffers + OS cache
work_mem = 16MB                     # per sort/hash, per query node
maintenance_work_mem = 512MB        # VACUUM, CREATE INDEX, compression

# --- WAL / checkpoints ---
max_wal_size = 2GB
min_wal_size = 512MB

# --- Storage (NVMe) ---
random_page_cost = 1.1              # random reads are nearly as cheap as sequential
effective_io_concurrency = 32
io_method = io_uring                # fall back to 'worker' if io_uring is unavailable
EOF
chown postgres:postgres conf.d/muirgen.conf
restorecon -Rv /mnt/nvme/pgsql/18/data/conf.d
```

**`io_uring` prerequisites.** PostgreSQL must be built with liburing, and the kernel must allow io\_uring. RHEL-family kernels often restrict it by default because io\_uring has had a history of kernel security bugs.

```bash
/usr/pgsql-18/bin/pg_config --configure | tr ' ' '\n' | grep -i liburing   # expect --with-liburing
sysctl kernel.io_uring_disabled                                           # 0 = allowed

# If it is not 0:
echo 'kernel.io_uring_disabled = 0' > /etc/sysctl.d/99-io-uring.conf
sysctl --system
```

If either check fails, set `io_method = worker`. On a Pi the performance difference is modest.

Apply and verify:

```bash
systemctl restart postgresql-18
sudo -u postgres psql -c "SHOW shared_preload_libraries;" -c "SHOW io_method;" -c "SHOW timescaledb.license;"
```

**Authentication.** PGDG's initdb uses `peer` for local sockets and `scram-sha-256` for TCP on localhost. The backend and the n2k daemon connect over localhost with a password, so `pg_hba.conf` needs no changes. Avoid the old `md5` method, which is deprecated in PostgreSQL 18.

## 7. Roles, database, and data

Use **7a** for a brand-new install or **7b** to bring data over from an existing server.

### 7a. Fresh install

```bash
su - postgres -c "createuser --no-superuser --createdb --no-createrole admin"
su - postgres -c "psql -c \"ALTER ROLE admin WITH PASSWORD '<choose-a-password>';\""
su - postgres -c "createdb --owner admin muirgen"
su - postgres -c "psql -d muirgen -f /root/muirgen.sql"     # copy muirgen.sql somewhere postgres can read first
```

The schema creates the `timescaledb`, `postgis` and `postgis_raster` extensions itself.

### 7b. Migrate from an existing server

**On the source server**, dump the roles and the database. A per-database dump doesn't include roles, and `admin` must exist before the restore can assign ownership.

```bash
sudo -u postgres pg_dumpall --roles-only -f /tmp/muirgen-roles.sql
sudo -u postgres pg_dump -Fc -d muirgen -f /tmp/muirgen.dump
```

Warnings about circular foreign-key constraints on TimescaleDB catalog tables are normal. Stop the backend and the n2k daemon first if you don't want to lose rows written after the dump.

**On the Pi**, copy both files to `/mnt/nvme/migration/`, owned by `postgres`. Then restore:

```bash
cd /mnt/nvme/migration

# 1. Roles. "role postgres already exists" is expected and harmless
sudo -u postgres psql -f muirgen-roles.sql

# 2. Empty database, with TimescaleDB at the SAME version as the source
sudo -u postgres createdb --owner admin muirgen
sudo -u postgres psql -d muirgen -c "CREATE EXTENSION timescaledb VERSION '2.24.0';"

# 3. Restore, bracketed by pre/post restore
sudo -u postgres psql -d muirgen -c "SELECT timescaledb_pre_restore();"
sudo -u postgres pg_restore -d muirgen --verbose muirgen.dump 2>&1 | tee restore.log
sudo -u postgres psql -d muirgen -c "SELECT timescaledb_post_restore();"

# 4. Refresh planner statistics (a restore doesn't copy them)
sudo -u postgres psql -d muirgen -c "ANALYZE;"
```

`timescaledb_pre_restore()` puts the database in restoring mode. It pauses the background scheduler, so compression and retention jobs don't run against half-loaded chunks, and it lets TimescaleDB's catalog rows be inserted directly. `timescaledb_post_restore()` turns that off and restarts the jobs.

PostGIS needs no special handling. The dump's `CREATE EXTENSION postgis` installs the Pi's version (3.6.4), and the stored data format is unchanged.

**Verify** by running these on **both** servers and comparing the output:

```sql
-- Hypertables, chunk counts, compression
SELECT hypertable_name, num_chunks, compression_enabled
FROM timescaledb_information.hypertables ORDER BY 1;

-- Background jobs (should list the compression and retention policies)
SELECT job_id, proc_name, hypertable_name, schedule_interval, scheduled
FROM timescaledb_information.jobs ORDER BY job_id;

-- Exact row count per hypertable (psql: \gexec runs each generated query)
SELECT format('SELECT %L AS hypertable, count(*) FROM %I.%I',
              hypertable_name, hypertable_schema, hypertable_name)
FROM timescaledb_information.hypertables ORDER BY 1 \gexec
```

Then check `restore.log` for any lines containing `error` (for example with `grep -i error restore.log`).

## 8. Application stack

Muirgen runs across two machines:

- **`muirgen-mf` (Pi 5):** PostgreSQL and TimescaleDB, the Mosquitto MQTT broker, nginx on port 80, and the Node.js backend on port 5000, which serves the built React frontend and `/api`.
- **`n2k-injest` (Pi 4 with a PiCAN-M HAT):** runs `muirgen-n2kd`. It reads the NMEA 2000 backbone on `can0`, writes to the database over the network, and publishes live telemetry to MQTT.

### 8.1 Packages

nginx and Node.js 22 come from AppStream; Mosquitto comes from EPEL. pm2 keeps the Node backend running and restarts it if it crashes.

```bash
dnf install -y nginx mosquitto nodejs nodejs-npm
node -v        # expect v22.x
npm install -g pm2
```

Don't enable nginx or mosquitto yet. Their configs come in the following steps.

### 8.2 Name resolution

Both machines find each other through `/etc/hosts`, so the boat network doesn't depend on DNS. Put these same lines on **both** `muirgen-mf` and `n2k-ingest`:

```
# Muirgen
10.255.8.2   n2k-ingest   # Raspberry Pi 4 + PiCAN-M
10.255.8.3   muirgen-mf   # Raspberry Pi 5 + NVMe
```

Make sure each name appears on **only one** line. EL's `/etc/host.conf` has `multi on`, so a duplicate name returns every address listed for it. A client could then silently connect to the wrong machine, such as a retired server.

### 8.3 Database access for n2k-ingest

Three layers must all allow the connection. Each one is a separate check.

1. **`listen_addresses`:** which local network interfaces PostgreSQL listens on. Add the Pi 5's LAN address alongside `localhost`. This setting requires a restart.
2. **`pg_hba.conf`:** who may log in, to which database, from where, and how. This line allows only `admin`, only to `muirgen`, only from the Pi 4, and only with a SCRAM password.
3. **firewalld:** a rich rule that opens port 5432 to the Pi 4's address only, not to the whole `public` zone.

```bash
sed -i "s|^listen_addresses = .*|listen_addresses = 'localhost,10.255.8.3'   # + LAN for n2k-ingest|" \
    /mnt/nvme/pgsql/18/data/conf.d/muirgen.conf

echo 'host    muirgen    admin    10.255.8.2/32    scram-sha-256    # n2k-ingest' \
    >> /mnt/nvme/pgsql/18/data/pg_hba.conf

firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.255.8.2/32" port port="5432" protocol="tcp" accept'
firewall-cmd --reload

systemctl restart postgresql-18
ss -tlnp | grep 5432          # expect 127.0.0.1:5432 and 10.255.8.3:5432
```

### 8.4 Mosquitto (MQTT)

The Muirgen config enables an anonymous listener on port 1883 for all interfaces. The firewall rule limits who can actually reach it from the network to n2k-ingest. The backend on the same box connects over localhost.

```bash
# Make mosquitto read /etc/mosquitto/conf.d/
sed -i 's|^#include_dir.*|include_dir /etc/mosquitto/conf.d|' /etc/mosquitto/mosquitto.conf
grep '^include_dir' /etc/mosquitto/mosquitto.conf

mkdir -p /etc/mosquitto/conf.d
cat > /etc/mosquitto/conf.d/muirgen.conf <<'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF

firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.255.8.2/32" port port="1883" protocol="tcp" accept'
firewall-cmd --reload

systemctl enable --now mosquitto
ss -tlnp | grep 1883
```

Quick test. Run the subscriber in one terminal and the publisher in another:

```bash
mosquitto_sub -h localhost -t 'muirgen/test' -v
mosquitto_pub -h localhost -t 'muirgen/test' -m 'hello'
```

### 8.5 Verify from n2k-ingest

Run the daemon on the Pi 4 (`cargo run` in `~/daemons/muirgen-n2kd`). It should print `Access granted.` for the database and `MQTT Thread Connected to Broker.` If it can't connect, test the ports directly from the Pi 4:

```bash
timeout 3 bash -c '</dev/tcp/muirgen-mf/5432' && echo 'pg ok'
timeout 3 bash -c '</dev/tcp/muirgen-mf/1883' && echo 'mqtt ok'
```

### 8.6 App directories, SELinux and firewall (on muirgen-mf, as root)

nginx runs confined as `httpd_t`. It needs three permissions that SELinux does not grant by default:

- **Reading from home directories:** the `httpd_enable_homedirs` boolean.
- **Reading uploads:** files labelled `httpd_sys_content_t`. `semanage fcontext` makes that label permanent, so it survives a relabel; a one-off `chcon` would not.
- **Proxying to Node on port 5000:** the `httpd_can_network_connect` boolean. Without it, every page returns 502 Bad Gateway, and `ausearch` shows `name_connect` denials.

```bash
id admin                                   # confirm the app user exists
mkdir -p /home/admin/fui/uploads
chown -R admin:admin /home/admin/fui
chmod 755 /home/admin                      # nginx must be able to traverse into it

setsebool -P httpd_enable_homedirs 1
setsebool -P httpd_can_network_connect 1
semanage fcontext -a -t httpd_sys_content_t "/home/admin/fui/uploads(/.*)?"
restorecon -Rv /home/admin/fui/uploads

firewall-cmd --permanent --add-service=http
firewall-cmd --reload
systemctl enable nginx
```

### 8.7 Laptop access (on the dev laptop)

The deploy scripts use SSH as both `root@` and `admin@`. After a rebuild, the host key changes, so clear the old one first.

```bash
getent hosts muirgen-mf          # must resolve to 10.255.8.3
ssh-keygen -R muirgen-mf
ssh-copy-id root@muirgen-mf
ssh-copy-id admin@muirgen-mf
```

### 8.8 Deploy the code

Run `./update_muirgen-mf` from the repo root on the laptop. It copies the nginx and mosquitto configs and the `fui` code, restarts nginx, then runs `npm install` and `npm run build` on the Pi.

On the first run, its last step, `pm2 restart muirgen`, fails because pm2 doesn't know that process yet. Section 8.10 creates it.

**First deploy only: install the sub-project dependencies.** `fui` is three npm projects, each with its own `package.json`: `fui/`, `fui/backend/` and `fui/frontend/`. The script only runs `npm install` in `fui/`, so on a new server the build fails until the other two are installed. Later deploys don't need this: rsync excludes `node_modules`, so these installs persist.

```bash
# On muirgen-mf as admin, after the first ./update_muirgen-mf
cd /home/admin/fui/backend  && npm install
cd /home/admin/fui/frontend && npm install     # npm ci once the lockfile in git is current
cd /home/admin/fui && npm run build
ls -la frontend/dist/                          # index.html + assets/
```

`npm ci` installs exactly what `package-lock.json` records, and refuses to run if that file doesn't match `package.json`. During the migration, the committed frontend lockfile was stale, so use `npm install`, then copy the updated `package-lock.json` back into the repo and commit it. The build should report **Vite 7**, which is the frontend's own copy. If it reports Vite 5, `frontend/node_modules` is missing, and `npx` has fallen back to the older copy in `fui/`.

**Power:** a Pi 5 needs a 5 V / 5 A (27 W) supply. A generic USB-C PD source (at most 5 V / 3 A) browns out under load, such as `npm install` or builds. If the power fails partway through an install, delete that project's `node_modules` and reinstall.

The backend also calls `heif-convert` (HEIC photos) and `ffmpeg` (video). Check that both exist: `which heif-convert ffmpeg || dnf install -y libheif-tools ffmpeg`.

If nginx fails to restart, run `nginx -t`. A warning that `conflicting server name "_"` was ignored is harmless: the stock server block in `nginx.conf` is loaded after `conf.d/`, so Muirgen's block wins.

### 8.9 Backend secrets

The deploy script never copies `.env` files, because `*` doesn't match dotfiles, so create the real ones on the server. When migrating, copy the old server's file. Keeping the same `JWT_SECRET` keeps existing logins valid.

```bash
# On muirgen-mf as admin (old VM at 10.255.1.0)
scp admin@10.255.1.0:/home/admin/fui/backend/.env /home/admin/fui/backend/.env
chmod 600 /home/admin/fui/backend/.env
grep -E '^(DB_HOST|DB_PORT|DB_DATABASE|MQTT_SERVER|MAP_SERVER_URL|PORT)=' /home/admin/fui/backend/.env
```

Expected values: `DB_HOST=localhost`, `DB_PORT=5432`, `DB_DATABASE=muirgen`, `MQTT_SERVER=localhost`. On a fresh install, start from the repo's `fui/backend/.env` template and fill in real values.

### 8.10 Start the backend with pm2, and start it at boot

`package.json`'s `start` script is `node backend/index.js`. Registering it under the name `muirgen` is what the deploy script's `pm2 restart muirgen` expects.

```bash
# As admin
cd /home/admin/fui
pm2 start backend/index.js --name muirgen
pm2 logs muirgen --lines 30        # expect: "Backend online on port 5000" and
                                   # "Node backend established comms with MQTT broker successfully."
```

Then browse to `http://muirgen-mf/`.

To start at boot, the work is split between two users:

- **root** installs `pm2-admin.service`, a systemd unit that starts pm2 as `admin` at boot.
- **admin** runs `pm2 save`, which writes admin's process list to `/home/admin/.pm2/dump.pm2`. That unit restores the list at boot.

Each user has their own pm2 daemon and process list. Running `pm2 save` as root (or with `sudo`) saves root's empty list instead. Use the full path `/usr/local/bin/pm2` as root, because sudo's `secure_path` doesn't include `/usr/local/bin`.

```bash
# As root: install the boot unit that runs pm2 as admin
env PATH=$PATH:/usr/bin /usr/local/bin/pm2 startup systemd -u admin --hp /home/admin
systemctl status pm2-admin --no-pager

# As admin (not sudo): save admin's process list
pm2 save

# Test with a reboot, then:
systemctl is-active postgresql-18 mosquitto nginx pm2-admin
```

Check the shell prompt before each command, because pm2 acts on whichever user runs it. If root was used by mistake, remove root's empty daemon **from a root shell**: `/usr/local/bin/pm2 kill && rm -rf /root/.pm2`. Running `pm2 kill` as admin stops the Muirgen backend. If that happens, re-run `pm2 start backend/index.js --name muirgen` as admin, then `pm2 save`.

`pm2-admin.service` shows `inactive (dead)` until the next boot; that is normal. Don't `systemctl start` it while admin's pm2 is already running. Use a reboot to test it.

### 8.11 Copy uploaded files (migration only)

The restored `files` table references these files, but they live on the old server's disk. The simplest way to copy them is to stream them **through the laptop**, which already has SSH keys for both servers. `tar` packs on one end and unpacks on the other, and nothing is written to the laptop's disk.

```bash
# On the laptop (old server = muirgen-mf.vm)
ssh admin@muirgen-mf.vm "du -sh /home/admin/fui/uploads; find /home/admin/fui/uploads -type f | wc -l"
ssh admin@muirgen-mf.vm "tar -C /home/admin/fui -cf - uploads" | ssh admin@muirgen-mf "tar -C /home/admin/fui -xf -"
ssh admin@muirgen-mf "du -sh /home/admin/fui/uploads; find /home/admin/fui/uploads -type f | wc -l"   # counts must match

# On muirgen-mf as root
restorecon -Rv /home/admin/fui/uploads
```

The backend writes uploads to `uploads/` under its **working directory** (`process.cwd()`). pm2 records that directory in `dump.pm2`, so always start the backend from `/home/admin/fui`. Otherwise new uploads land outside nginx's `/uploads/` alias.

If you have a file-level backup of the old server's `/home`, you can restore from it instead: `rsync -av <backup>/home/admin/fui/uploads/ admin@muirgen-mf:/home/admin/fui/uploads/`, then run `restorecon` as above.

### 8.12 Not yet covered

These pieces work today but aren't documented as a repeatable procedure yet. They'll be folded in, or replaced, once Muirgen is packaged as RPMs. The plan is separate packages for the MFD server and for n2k-ingest, so ingest can run on its own Pi or on the same box.

- **Map server (`muirgen-maps`):** the backend's `MAP_SERVER_URL` points at `http://muirgen-maps/services`, which is a separate project (`Maps/`). Where it runs aboard is still to be decided.
- **n2k-ingest (Pi 4 + PiCAN-M):**
  - The device-tree overlay that creates `can0` isn't documented yet.
  - `can0-n2k.service` brings the bus up at 250 kbit/s with `restart-ms 100`, so the kernel recovers automatically from bus-off. `restart-ms` must be on the `type can` line.
  - `tools/etc/sysctl.d/99-muirgen.conf` (larger socket receive buffers and network backlog) belongs on **n2k-ingest**; load it with `sysctl --system`.
  - The daemon currently runs with `cargo run`. The target setup is a `cargo build --release` binary with its own systemd unit.
  - `candump` (from `can-utils`) can run alongside the daemon for debugging, because SocketCAN gives each reader its own copy of every frame.

## 9. Maintenance

### Upgrading TimescaleDB

A TimescaleDB upgrade has two parts. First, install the new version's libraries next to the old ones. Then run `ALTER EXTENSION ... UPDATE`, which applies the SQL update script (for example `timescaledb--2.24.0--2.30.1.sql`) to each database's catalog.

Before upgrading, read the release notes between your current version and the target in [CHANGELOG.md](https://github.com/timescale/timescaledb/blob/main/CHANGELOG.md). Look for anything marked **Backward-Incompatible Changes**.

```bash
# 0. Have a backup (pg_dump -Fc), and stop the writers (backend, n2k daemon)

# 1. Build and install the new version (same steps as section 5)
TSDB_VER=2.30.1
cd /usr/local/src
git clone --branch ${TSDB_VER} --depth 1 https://github.com/timescale/timescaledb.git timescaledb-${TSDB_VER}
cd timescaledb-${TSDB_VER}
./bootstrap -DCMAKE_BUILD_TYPE=Release -DPG_CONFIG=/usr/pgsql-18/bin/pg_config \
            -DREGRESS_CHECKS=OFF -DTAP_CHECKS=OFF -DWARNINGS_AS_ERRORS=OFF
cd build && make -j4 && make install
restorecon -Rv /usr/pgsql-18/lib /usr/pgsql-18/share/extension

# 2. Restart so the server loads the new loader (timescaledb.so)
systemctl restart postgresql-18

# 3. Update the extension in each database that uses it.
#    -X skips ~/.psqlrc: the UPDATE must be the first command in a fresh
#    session, before anything loads the old version's library.
sudo -u postgres psql -X -d muirgen -c "ALTER EXTENSION timescaledb UPDATE;"

# 4. Verify
sudo -u postgres psql -d muirgen -c "SELECT extname, extversion FROM pg_extension;"
```

The old version's `.so` files can stay; they're a few MB and allow a quick rollback. Remove them only after the new version has run cleanly for a while.

### PostGIS

PostGIS updates arrive through `dnf update` (PGDG). After a minor or micro update, bring each database's extension up to date:

```bash
sudo -u postgres psql -d muirgen -c "SELECT postgis_extensions_upgrade();"
```

## 10. Troubleshooting and gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| `timescaledb-2-postgresql-18` not found on the Pi | Timescale's packagecloud repo only publishes x86\_64 RPMs | Don't add that repo; build from source (section 5). Remove `/etc/yum.repos.d/timescale_timescaledb.repo` if present |
| PGDG repo GPG key rejected by EL10 ("No binding signature") | Older PGDG repo file pointed at a legacy key | Use the current repo file, which references `PGDG-RPM-GPG-KEY-AARCH64-RHEL`, with `repo_gpgcheck = 1`. Keep `gpgcheck = 1` in all cases |
| `pgdg-redhat-all.repo.rpmnew` appears | Repo package upgraded over a locally edited file | Replace the old file with the `.rpmnew`, then re-apply the disable and exclude settings (section 3) |
| `timescaledb_18` from PGDG lacks compression and policies | PGDG's build is Apache-only | Keep `pgdg18.exclude='timescaledb_*'`; use the source build |
| PostgreSQL fails to start from `/mnt/nvme` | Usually an SELinux label or ownership problem | `journalctl -u postgresql-18 -n 50`, `ausearch -m avc -ts recent`, then re-run `restorecon -Rv /mnt/nvme/pgsql` |
| Startup error mentioning `io_method` | PostgreSQL built without liburing, or io\_uring disabled by sysctl | See section 6, or set `io_method = worker` |
| "Connection refused" on 5432 from n2k-ingest | PostgreSQL still listening on localhost only; listen\_addresses is read only at startup | systemctl restart postgresql-18, then check ss -tlnp \| grep 5432. "Refused" means the firewall passed the packet but nothing is listening; a firewall block hangs until timeout instead |
| Client connects to the wrong server by name | Same hostname on two /etc/hosts lines; multi on returns both | Comment out the stale line; getent ahostsv4 \<name> should list one address |
| Every page returns 502 Bad Gateway | SELinux blocks nginx from connecting to Node on port 5000 | setsebool -P httpd\_can\_network\_connect 1 (section 8.6). Also check pm2 list shows muirgen online |
| Build fails: Rollup failed to resolve import "react-dom/client" | frontend/ (and backend/) dependencies were never installed; the deploy script only installs fui/ | Run npm install in fui/backend and fui/frontend once (section 8.8) |
| npm ci: package.json and package-lock.json are not in sync | Dependencies were added without committing the updated lockfile | npm install, then copy the new package-lock.json back into the repo and commit it |
| pm2 save: "PM2 is not managing any process" | Run as the wrong user; each user has their own pm2 daemon and process list | Run pm2 start and pm2 save as admin; only pm2 startup runs as root (section 8.10) |
| Pi 5 reboots or crashes under load (npm install, builds) | Undervoltage: a USB-C PD source gives at most 5 V / 3 A | Use a 5 V / 5 A supply; check journalctl -k -b -1 \| grep -i voltage; reinstall any node\_modules that was being written |
| can0 never comes up after editing can0-n2k.service | restart-ms given without type can; ip rejects it and systemd stops at the failed ExecStart | ip link set can0 type can bitrate 250000 restart-ms 100 |

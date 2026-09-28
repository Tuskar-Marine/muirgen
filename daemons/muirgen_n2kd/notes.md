# General Notes
Using 'rustup' instead if rpms via dnf to get access to latest toolchains and cross-compiled simplicity.

## Environment Setup
OS: AlmaLinux 10 on an raspberry pi 4 with the Copperhill PICAN-M HAT

## PICAN-M HAT Setup

### SPI Setup

To enable the Raspberry Pi's SPI layer, update /boot/config.txt and append under '[all]' the following;

 dtparam=spi=on
 dtoverlay=mcp2515-can0,oscillator=16000000,interrupt=25

Reboot after adding these lines.

### Canbus Network Config

Verify that there is now a 'can0' device when running 'ip addr list can0'.

NOTE: If you use (or get) anything other than 'can0', be sure to update N2K_DEV in '.env' and copy/edit the can0-n2k.service to reflect the actual device!

 ip addr list can0
 3: can0: <NOARP,ECHO> mtu 16 qdisc noop state DOWN group default qlen 10
    link/can 

If the adapter is there, enable it.

 ip link set can0 up type can bitrate 250000
 ip addr list can0

Verify that state is now UP.

3: can0: <NOARP,UP,LOWER_UP,ECHO> mtu 16 qdisc pfifo_fast state UP group default qlen 10
    link/can 

Connect to the N2K bus with a device that is transmitting and verify that the device can see N2K PGNs;

 candump can0
  can0  18EEFF23   [8]  EB 9D E1 10 00 B4 A0 C0
  can0  0DF11923   [8]  00 FF 7F FF 7F FF 7F FF
  can0  09F11323   [8]  00 FF FF FF 7F FF FF FF
  can0  09F80123   [8]  FF FF FF 7F FF FF FF 7F
  can0  09F80223   [8]  FF FC FF FF FF FF FF FF
  can0  0DF80523   [8]  00 2B FF FF FF FF FF FF
(Press ctrl + c to end stream)

### Memory Config

This assumes the daemon is running on a dedicated N2K ingestion server / appliance. In particular, a Raspberry Pi 4 with 4+ GiB of RAM.

The default '99-muirgen.conf' (installed in /etc/sysctl.d/) boosts the memory allocation significantly. Review if your hardware differs significantly. 

### Almalinux 10 base OS setup
Dependencies to install;

 dnf install epel-release
 /usr/bin/crb enable
 dnf groupinstall development
 dnf install pkgconf openssl-devel can-utils chrony

## Rust general notes
Create an unprivileged user. These notes assume 'admin'

### Directory structure
/home/admin/.rustup       # - Metadata
/home/admin/.cargo        # - cargo (extension/library) home directory
/home/admin/.cargo/bin    # - cargo binaries

### Rust install

 curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
Accept the defaults;
====
  default host triple: aarch64-unknown-linux-gnu
  default toolchain: stable (default)
  profile: default
  modify PATH variable: yes
====

## Setting up chrony For Time Serving

Muirgen updated the host system time from the GNSS time data when available, or from a sensor on the N2K bus with a TCXO if the GNSS time is unavailable. To enable the daemon to send time update struc's to chronyd's socket, we need to setup the host system.

Allow `admin` (or whichever user owns/runs 'muirgen_n2kd');

 usermod -aG chrony admin

If you plan to run the daemon, log back in to update the active shell session. 

Append to `/etc/chrony.conf`:

```
# Accept NMEA 2000 System Time from the Muirgen Daemon
refclock SOCK /var/run/chrony/chrony.n2k.sock refid GNSS
```

Run `systemctl edit chronyd` and update the service to make the socket group-writable;

```
### Editing /etc/systemd/system/chronyd.service.d/override.conf
### Anything between here and the comment below will become the contents of the drop-in file

[Service]
# Wait a moment for chrony to create the socket file
ExecStartPost=/bin/sleep 1
# Change group ownership to chrony so our admin user can access it
ExecStartPost=/usr/bin/chgrp chrony /var/run/chrony/chrony.n2k.sock
# Grant read/write access to the 'chrony' group
ExecStartPost=/usr/bin/chmod 660 /var/run/chrony/chrony.n2k.sock

### Edits below this comment will be discarded
```

Restart the daemon and verify;

```
systemctl daemon-reload
systemctl enable --now chronyd
systemctl restart chronyd
ls -lah /var/run/chrony/chrony.n2k.sock
```

Verify that the mode is `srw-rw----`. 

```
srw-rw----. 1 root root 0 May 25 02:01 /var/run/chrony/chrony.n2k.sock
```

### Hardware Latency Offset

After you have the time source running for a while, check the output of `chronyc sources -v`. It should look like this:

```
  .-- Source mode  '^' = server, '=' = peer, '#' = local clock.
 / .- Source state '*' = current best, '+' = combined, '-' = not combined,
| /             'x' = may be in error, '~' = too variable, '?' = unusable.
||                                                 .- xxxx [ yyyy ] +/- zzzz
||      Reachability register (octal) -.           |  xxxx = adjusted offset,
||      Log2(Polling interval) --.      |          |  yyyy = measured offset,
||                                \     |          |  zzzz = estimated error.
||                                 |    |           \
MS Name/IP address         Stratum Poll Reach LastRx Last sample               
===============================================================================
#x GNSS                          0   4   377    21    +81ms[  +81ms] +/- 3177us
^+ hub.coreserv.net              2  10   377   110  -2331us[-2331us] +/-   43ms
^* linuxgeneration.org           3  10   377   514  -1217us[-1148us] +/-   22ms
^- s216-232-132-63.bc.hsia.>     2  10   377   131  -1273us[-1273us] +/-  295ms
^- tangent.muug.ca               2  10   377    64  -1569us[-1569us] +/-   60ms
```

Note the +81ms on the GNSS line, that is the hardware's internal processing time. This is being registered by chronyd as a hardware fault, and so the time source is being ignored, despite having the best general latency of `3177us`. 

Knowing that the hardware's internal processing time is `+81ms`, we can tell `chrony` to offset that. 

Edit `/etc/chrony.conf` again and change the `refclock` line added earlier to this, but using your hardware's offset in place of `-0.081`;

```
refclock SOCK /var/run/chrony/chrony.n2k.sock refid GNSS offset -0.081 delay 0.1 prefer trust
```

Save the changes and restart the `chronyd` daemon;

```
systemctl restart chronyd
```

After receiving updates long enough to get `Reach` up to `377`, you should see something like;

```
  .-- Source mode  '^' = server, '=' = peer, '#' = local clock.
 / .- Source state '*' = current best, '+' = combined, '-' = not combined,
| /             'x' = may be in error, '~' = too variable, '?' = unusable.
||                                                 .- xxxx [ yyyy ] +/- zzzz
||      Reachability register (octal) -.           |  xxxx = adjusted offset,
||      Log2(Polling interval) --.      |          |  yyyy = measured offset,
||                                \     |          |  zzzz = estimated error.
||                                 |    |           \
MS Name/IP address         Stratum Poll Reach LastRx Last sample               
===============================================================================
#* GNSS                          0   4   377     9    -23us[  +27us] +/-   54ms
^? s216-232-132-18.bc.hsia.>     0   6     0     -     +0ns[   +0ns] +/-    0ns
^x xlrsecurity.com               2   6   377    24   -166ms[ -166ms] +/-   13ms
^x ntp1.torix.ca                 1   6   377    25   -175ms[ -175ms] +/-   22ms
^x ntp2.torix.ca                 1   6   377    25   -166ms[ -166ms] +/-   11ms
```

The `#*` indicates that the GNSS is now the best and chosen time source. Note that the Last Sample could show a higher value while the clock catches up if chronyd had to adjust to the updated time. 

### Enabling the ntpd server

With the n2k-ingest server sync'ing it's time from GNSS / GPS, we can now setup the host as a stratum 1 NTP server for the rest of the machines on the network.

Edit the `/etc/chronyd.conf` file and add the following;

```
# Allow any device on the vessel's network to query the time. 
# NOTE: To restrict to a subnet, use: 
#allow 192.168.1.0/24
allow all

# If GNSS and Internet are both offline, serve the local hardware clock to 
# ensure vessel-wide time sync.
# Announce as Stratum 10 so it is overridden if GNSS/Internet returns
local stratum 10
```

Open the `ntp` port in the firewall;

```
firewall-cmd --add-service=ntp --permanent
firewall-cmd --reload
```

Now (re)start the chronyd daemon.

To test that the server is now operating as a time server, from another machine, run:

```
sudo chronyd -Q 'server n2k-ingest iburst'
```

Note to change `n2k-ingest` with the IP or hostname of your server.

If you see a reply like:

```
2026-05-25T21:22:49Z chronyd version 4.8 starting (+CMDMON +REFCLOCK +RTC +PRIVDROP +SCFILTER +SIGND +NTS +SECHASH +IPV6 +DEBUG)
2026-05-25T21:22:49Z Disabled control of system clock
2026-05-25T21:22:54Z System clock wrong by 0.000264 seconds (ignored)
2026-05-25T21:22:54Z chronyd exiting
```

Your new ntp server is up and running!

# Project Notes

## Setup the project (muirgen_n2kd)

As 'admin':

```
cd ~
if [ ! -d ~/daemons ]; then mkdir daemons; fi
cd ~/daemons
cargo new muirgen-n2kd
cd ~/daemons/muirgen-n2kd
```

Install serde_json and mqtt;

```
cargo add serde_json
cargo add rumqttc
```

The main config for the program is in Cargo.toml (define dependencies here, for example). The program's root is in the 'src' sub directory.

```
cd ~/daemons/muirgen-n2kd/src
```

There is a sample program called 'main.rs' that you can compile and run;

```
cargo run
```

This will compile and run the program. The compiled output is stored under '~/daemons/muirgen-n2kd/target/debug/'.



## Application notes

Update the ~/daemons/muirgen_n2kd/.env to have the proper DB connection details and authentication.
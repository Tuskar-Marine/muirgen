ToDo:
- Currently, uplaods are limited to 50 MiB. Bump that to 250 MiB to support short videos. To support large,
  we'll need to implement chunked uploads. 
- (Large Files): Replace the DataViewer->res.blob() logic with a streaming approach for files > 250 MiB (or 
  whatever the current Nginx upload limit is). The backend should generate a short-lived, single-use JWT 
  token specifically for this file UUID. Pass that token as a query parameter 
  (e.g., /api/files/:uuid/stream?token=abc...). Then create a hidden <a> tag with href=URL and 
  target="_blank" to natively trigger the browser's internal streaming download engine, bypassing RAM 
  limitations entirely.
- Add a KITT style visualiser for audio files.
- Curently, /uploads/ is not protectect. If / when that changes, we'll need to create an 
  /api/files/:uuid/stream endpoint that handles the 'range: xxx' chunking.
- Currently, only new logs are auto-saved. If a user is in a prolonged edit session of an existing log, the 
  data will be lost of there is a disconnect. Resolving this requires crash recovery, multi-user access 
  controls, resolving sourve of truth issues, etc. Absolutely what we want, but too much in the early stages
  of development.
- Enable IPv6 support when closer to release. Leaving IPv4 for simplified debugging during early dev.
- [ROUTING 1 - Planning]: Implement basic manual route planning. Plot GeoJSON LineStrings on the map and calculate distance/bearing between waypoints.
- [ROUTING 2 - Active]: Implement active route monitoring. Calculate Cross-Track Error (XTE), Bearing to Waypoint (BTW), and Time to Go (TTG) using Haversine math.
- [ROUTING 3 - Automated]: Implement draft-aware auto-routing (A* or Dijkstra). Use S-57 LNDARE/DEPARE to create a cost-surface "Nav Mesh" that routes around shallow water/land.
- [ROUTING 4 - Advanced Sailing/Weather]: Long-term task to build an Isochronal Weather Router. Ingest vessel Polars and GRIB files. Mathematically expand isochrones to calculate optimal tacking angles and times. Add ML auto-tuning to heal polar tables over time via TimescaleDB telemetry, and support complex Motor-Sailing optimization (constrained fuel/battery equations).


# Install Notes

Almalinux 10 base OS setup. Assumes the unprivileged user is `admin`.

Enable encumbered media conversion support and postgresql v18 + timesscale extension repos.

Installing PostgreSQL v18 and TimescaleDB v2 on Raspberry Pi 5.
```
dnf config-manager --save --setopt=pgdg18.exclude='timescaledb_*'
```

```
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm
# NOTE: As of Sep. 2026, the postgresql repo keys are SHA-1 signed, which is not supported by EL10. To fix, change: 'repo_gpgcheck = 1' to '0' in the pgsql repo file.

dnf install -y https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-10.noarch.rpm 
dnf install https://mirrors.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-10.noarch.rpm
curl -s https://packagecloud.io/install/repositories/timescale/timescaledb/script.rpm.sh | sudo bash
# NOTE: As of Sep. 2026, the installed repo setups up for el/10, but that doesn't exist. To fix, change the repo's baseurl to 'el/9'
sed -i 's/el\/10/el\/9/g' /etc/yum.repos.d/timescale_timescaledb.repo

dnf install -y libheif libheif-freeworld ffmpeg rsync vim bash-completion postgresql18-server postgresql18-contrib timescaledb-2-postgresql-18
```

Needed for nginx access to uploads

```
chmod 755 /home/admin   
setsebool -P httpd_enable_homedirs 1
mkdir -p /home/admin/fui/uploads
chown admin:admin /home/admin/fui /home/admin/fui/uploads
chcon -R -t httpd_sys_content_t /home/admin/fui/uploads/
```

Mosquitto needs to be told to use it's includes directory. Edit `/etc/mosquitto/mosquitto.conf` and search for `include_dir`. If it is commented out, uncomment it and set it to:

```
include_dir /etc/mosquitto/conf.d
```

## Persistent Logging

TODO: Determine the impact on SDCards, possible want to change this to write to a systemlog on `muirgen-mf`'s NVMe drive.

For Almalinux 10;

```
mkdir -p /var/log/journal
chown root:systemd-journal /var/log/journal
chmod 2755 /var/log/journal
```

Edit or create the file `/etc/systemd/journald.conf` so that it is set to:

```
[Journal]
Storage=persistent
```

Restart and flush;

```
systemctl restart systemd-journald.service
journalctl --flush
```

# Glyphs and the Uses

Log out glyphs and where/how they're used.

⧲	10738	29F2	ERROR-BARRED WHITE CIRCLE                                           # User Index
◈	9672	25C8	WHITE DIAMOND CONTAINING BLACK SMALL DIAMOND                        # SysOp / Admin Icon
🞜	128924	1F79C	DIAMOND TARGET                                                      # Create a SysOp / Admin
◇	9671	25C7	WHITE DIAMOND                                                       # Operator / Unprivileged Operator
◫	9707	25EB	WHITE SQUARE WITH VERTICAL BISECTING LINE                           # VSM (Vessel Systems Monitor) icon
⏃	9155	23C3	DENTISTRY SYMBOL LIGHT VERTICAL WITH TRIANGLE                       # Vessel Index
▻	9659	25BB	WHITE RIGHT-POINTING POINTER                                        # <select/> Title
◺	9722	25FA	LOWER LEFT TRIANGLE                                                 # Cursor Prompt
⧏	10703	29CF	LEFT TRIANGLE BESIDE VERTICAL BAR	                            # Previous image (left)
⎚	9114	239A	CLEAR SCREEN SYMBOL                                                 # Close Image
⧐	10704	29D0	VERTICAL BAR BESIDE RIGHT TRIANGLE                                  # Next image (right)
▷	9655	25B7	WHITE RIGHT-POINTING TRIANGLE                                       # Left side of safe / normal confirm
◁	9665	25C1	WHITE LEFT-POINTING TRIANGLE                                        # Right side of safe / normal confirm
◬	9708	25EC	WHITE UP-POINTING TRIANGLE WITH DOT                                 # Used for 'unknown'
🞪	128938	1F7AA	MEDIUM SALTIRE                                                      # Used for "End Session"
╔	9556	2554	DOUBLE DOWN AND RIGHT                                               # Inactive entry, lead in
╗	9559	2557	DOUBLE DOWN AND LEFT                                                # Inactive entry, lead out
╠	9568	2560	DOUBLE VERTICAL AND RIGHT                                           # Active entry, lead in
╣	9571	2563	DOUBLE VERTICAL AND LEFT                                            # Active entry, lead out
⌬	9004	232C	BENZENE RING                                                        # Edit
⌧	8999	2327	X IN A RECTANGLE BOX                                                # Deactivate / Disable / Discard
⌗	8983	2317	VIEWDATA SQUARE                                                     # Activate / Save
⌲	9010	2332	CONICAL TAPER                                                       # Command prompt
◭	9709	25ED	UP-POINTING TRIANGLE WITH LEFT HALF BLACK                           # Left side of warning / dangerous confirm
◮	9710	25EE	UP-POINTING TRIANGLE WITH RIGHT HALF BLACK                          # Right side of warning / dangerous confirm
⧖	10710	29D6	WHITE HOURGLASS                                                     # Timers, count-downs, etc.
⌖	8982	2316	POSITION INDICATOR                                                  # Optics (Images)
⍍                                                                                           # Upload icon
⍓	9043	2353	APL FUNCTIONAL SYMBOL QUAD UP CARET                                 # Paste to upload icon
⍔       9044	2354	APL FUNCTIONAL SYMBOL QUAD DEL                                      # Download icon
⬎	11022	2B0E	RIGHTWARDS ARROW WITH TIP DOWNWARDS	                            # Remove from upload queue
⌀	8960	2300	DIAMETER SIGN                                                       # Indicates a file that is a duplicate / won't be uploaded
△	9651	25B3	WHITE UP-POINTING TRIANGLE                                          # Pinned log/note
⌭	9005	232D	CYLINDRICITY                                                        # Indicates an item is somehow restricted.
⧉                                                                                           # Notes/Logs
⎐	9104	2390	OPEN-CIRCUIT-OUTPUT L-TYPE SYMBOL                                   # Specifications
⛫	9963	26EB	CASTLE                                                              # Battery status
⌥	8997	2325	OPTION KEY                                                          # Config
◙	9689	25D9	INVERSE WHITE CIRCLE                                                # 
🞋	128907	1F78B	ROUND TARGET                                                        # 
⦵	10677	29B5	CIRCLE WITH HORIZONTAL BAR                                          # Motors
⏀	9152	23C0	DENTISTRY SYMBOL LIGHT VERTICAL WITH CIRCLE                         # 
⌖	8982	2316	POSITION INDICATOR                                                  # Sensors
⚠	9888	26A0	WARNING SIGN                                                        # General alarm
⏧	9191	23E7	ELECTRICAL INTERSECTION                                             # Navigation
▽	9661	25BD	WHITE DOWN-POINTING TRIANGLE                                        # Compass, Outer poiner (points towards the center)
△	9651	25B3	WHITE UP-POINTING TRIANGLE                                          # Compass, Inner poiner (points away from center)
┆	9478	2506	LIGHT TRIPLE DASH VERTICAL                                          # Data divider
🞊	128906	1F78A	WHITE CIRCLE CONTAINING BLACK SMALL CIRCLE                          # Accurate (<2 seconds)
🞉	128905	1F789	EXTREMELY HEAVY WHITE CIRCLE                                        # Fresh (<4 seconds)
🞈	128904	1F788	VERY HEAVY WHITE CIRCLE	                                            # Tolerable (<6 seconds)
🞇	128903	1F787	HEAVY WHITE CIRCLE	                                            # Aging (<7 seconds)
🞆	128902	1F786	BOLD WHITE CIRCLE	                                            # Borderline (<8 seconds)
🞅	128901	1F785	MEDIUM BOLD WHITE CIRCLE	                                    # Limit of useful (<9 seconds)
🟕	128981	1F7D5	CIRCLED TRIANGLE                                                    # Dead (>= 10 seconds)
⫽	2AFB	        Triple Solidus Binary Relation                                      # Breadcrumb divider 
⏦	9190	23E6	AC CURRENT                                                          # Wave data (height, period, etc)
➠	10144	27A0	HEAVY DASHED TRIANGLE-HEADED RIGHTWARDS ARROW                       # Wind information
➢	10146	27A2	THREE-D TOP-LIGHTED RIGHTWARDS ARROWHEAD                            # Heading information
🌐︎	&#x1F310;&#xFE0E; "\u{1F310}\u{FE0E}"	Globe with Meridians                        # Maps
⛈	9928	26C8	THUNDER CLOUD AND RAIN                                              # Weather Data
🞡	128929	1F7A1	THIN GREEK CROSS                                                    # Crosshairs
◬	9708	25EC	WHITE UP-POINTING TRIANGLE WITH DOT
⟐	10192	27D0	WHITE DIAMOND WITH CENTRED DOT
⏥	9189	23E5	FLATNESS                                                            # 
⏚	9178	23DA	EARTH GROUND                                                        # 
⍗	9047	2357	APL FUNCTIONAL SYMBOL QUAD DOWNWARDS ARROW                          # 
⎔	9108	2394	SOFTWARE-FUNCTION SYMBOL                                            # 
⇪	8682	21EA	UPWARDS WHITE ARROW FROM BAR                                        #
⏿	9215	23FF	OBSERVER EYE SYMBOL                                                 # 
⦨	10664	29A8	MEASURED ANGLE WITH OPEN ARM ENDING IN ARROW POINTING UP AND RIGHT  # 
⧆	10694	29C6	SQUARED ASTERISK                                                    # 
┻	9531	253B	HEAVY UP AND HORIZONTAL                                             # 
↥	8613	21A5	UPWARDS ARROW FROM BAR                                              # 
↧	8615	21A7	DOWNWARDS ARROW FROM BAR                                            # 
┳	9523	2533	HEAVY DOWN AND HORIZONTAL                                           # 
✗	10007	2717	BALLOT X                                                            # 
❖	10070	2756	BLACK DIAMOND MINUS WHITE X                                         # 
➾	10174	27BE	OPEN-OUTLINED RIGHTWARDS ARROW                                      # 
◹	9721	25F9	UPPER RIGHT TRIANGLE                                                # 
⬐	11024	2B10	LEFTWARDS ARROW WITH TIP DOWNWARDS                                  # 
⍀       2340            Enter Symbol (Abridged)                                             # 
⬏	11023	2B0F	RIGHTWARDS ARROW WITH TIP UPWARDS	
⬐	11024	2B10	LEFTWARDS ARROW WITH TIP DOWNWARDS	
⬑	11025	2B11	LEFTWARDS ARROW WITH TIP UPWARDS
⮑	11153	2B91	RETURN RIGHT                                                        # 
⮓	11155	2B93	NEWLINE RIGHT                                                       # 
↽	8637	21BD	LEFTWARDS HARPOON WITH BARB DOWNWARDS                               # 
⇍	8653	21CD	LEFTWARDS DOUBLE ARROW WITH STROKE                                  #
⇏	8655	21CF	RIGHTWARDS DOUBLE ARROW WITH STROKE                                 #
┢	9506	2522	UP LIGHT AND RIGHT DOWN HEAVY                                       # 
┏	9487	250F	HEAVY DOWN AND RIGHT                                                # 
┗	9495	2517	HEAVY UP AND RIGHT                                                  # 
┓	9491	2513	HEAVY DOWN AND LEFT                                                 # 
┛	9499	251B	HEAVY UP AND LEFT                                                   # 
╚	9562	255A	DOUBLE UP AND RIGHT                                                 # 
╝	9565	255D	DOUBLE UP AND LEFT                                                  # 
⏢	9186	23E2	WHITE TRAPEZIUM                                                     # 
⍃	9027	2343	APL FUNCTIONAL SYMBOL QUAD LESS-THAN	                            # 
⍄	9028	2344	APL FUNCTIONAL SYMBOL QUAD GREATER-THAN                             # 
⍂	9026	2342	APL FUNCTIONAL SYMBOL QUAD BACKSLASH                                # 
▵	9653	25B5	WHITE UP-POINTING SMALL TRIANGLE
◍	9677	25CD	CIRCLE WITH VERTICAL FILL
⌤	8996	2324	UP ARROWHEAD BETWEEN TWO HORIZONTAL BARS
🟇	128967	1F7C7	MEDIUM FOUR POINTED PINWHEEL STAR
⛁	9921	26C1	WHITE DRAUGHTS KING
☁	9729	2601	CLOUD	Try it
☂	9730	2602	UMBRELLA
≋               224B    Wind/Waves
┼	9532	253C	LIGHT VERTICAL AND HORIZONTAL
╪	9578	256A	VERTICAL SINGLE AND HORIZONTAL DOUBLE
◊	9674	25CA	LOZENGE
🞨	128936	1F7A8	THIN SALTIRE
🟀	128960	1F7C0	LIGHT THREE POINTED BLACK STAR
🟄	128964	1F7C4	LIGHT FOUR POINTED BLACK STAR
🟕	128981	1F7D5	CIRCLED TRIANGLE
✛	10011	271B	OPEN CENTRE CROSS


Bootstrap Icon
	glyphicon glyphicon-log-out	&#xe163;
	
☼	9788	263C	WHITE SUN WITH RAYS
☄	9732	2604	COMET
⌅	8965	2305	PROJECTIVE	Try it
⌆	8966	2306	PERSPECTIVE
⍙	9049	2359	APL FUNCTIONAL SYMBOL DELTA UNDERBAR
⏣	9187	23E3	BENZENE RING WITH CIRCLE

⚠	9888	26A0	WARNING SIGN
⚺	9914	26BA	SEMISEXTILE
⚼	9916	26BC	SESQUIQUADRATE


============
```
INSERT INTO vessels (uuid, name, flag_nation, port_of_registry, build_details, official_number, hull_id_number, keel_offset_cm, waterline_offset_cm, is_active) VALUES ('019bcfff-728f-7b48-822e-46c4b20a7326', 
'Mermaid''s Rest', 
'Canada', 
'Hamilton, ON', 
'1981 C&C Landfall 38', 
'845646', 
'CCY38113M81K',   CCY38999M82K
125, 
50, 
TRUE);
INSERT INTO users (uuid, vessel_uuid, handle, name, password_hash, is_admin) VALUES ('019bd012-a8aa-7655-aa95-b4d84130696f', '019bcfff-728f-7b48-822e-46c4b20a7326', 'digimer', 'Madison Kelly', '$2b$12$VldT57Ku8ZakYmU2o0Fhve1UqikBHHiaSddyntZSlFPvGm2zfQG/i', TRUE);
```

NOTE: Last checked, the installed repo setups up for el/10, but that doesn't exist. To fix, change the repo's baseurl to 'el/9';

grep baseurl /etc/yum.repos.d/timescale_timescaledb.repo 
#baseurl=https://packagecloud.io/timescale/timescaledb/el/10/$basearch
baseurl=https://packagecloud.io/timescale/timescaledb/el/9/$basearch
#baseurl=https://packagecloud.io/timescale/timescaledb/el/10/SRPMS
baseurl=https://packagecloud.io/timescale/timescaledb/el/9/SRPMS

# Now install the timescaledb licensed version.
dnf install timescaledb-2-postgresql-18

/usr/pgsql-18/bin/postgresql-18-setup initdb
mkdir -p /var/lib/pgsql/data
chown postgres:postgres /var/lib/pgsql/data
su - postgres -c "/usr/pgsql-18/bin/initdb -D /var/lib/pgsql/data"
systemctl edit postgresql-18
# Add:
====
[Service]
Environment=PGDATA=/var/lib/pgsql/data
====
systemctl daemon-reload 
vim /var/lib/pgsql/data/postgresql.conf 
# Add:
====
#listen_addresses = 'localhost'         # what IP address(es) to listen on;
listen_addresses = '*'

# Further down...

#shared_preload_libraries = ''          # (change requires restart)
shared_preload_libraries = 'timescaledb'
timescaledb.license = 'timescale'
====

If you have an NVMe drive, set the following in postgresql.conf as well:
====
#effective_io_concurrency = 16          # 1-1000; 0 disables issuing multiple simultaneous IO requests
effective_io_concurrency = 32
#io_method = worker                     # worker, io_uring, sync
io_method = io_uring                    
====

====
vim /var/lib/pgsql/data/pg_hba.conf 
# Add:
====
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    all             all             all                     md5
====
# Enable AIO
vim /etc/sysctl.d/99-io-uring.conf
# Add
====
kernel.io_uring_disabled = 0
====

systemctl start postgresql-18.service 

dnf config-manager --set-enabled crb
dnf install epel-release
dnf install postgis36_18 postgis36_18-utils 

### OS level;
# make sure 'noatime' is set for the nvme mount in /etc/fstab.

su - postgres -c "createuser --no-superuser --createdb --no-createrole admin";
su - postgres -c "psql template1 -c \"ALTER ROLE admin WITH PASSWORD 'Initial1';\""
su - postgres -c "createdb --owner admin mr-scifi-ui"


INSERT INTO vessels (vessel_uuid, vessel_name, vessel_official_number) VALUES ('4943d088-91c6-4877-87d1-f7a72cfac020', 'Mermaid''s Rest', '845646');


-=] Optimised query examples
-- Smooths the last 30 seconds of wind data for a React chart
SELECT 
    time,
    AVG(wind_true_speed) OVER (ORDER BY time ROWS BETWEEN 5 PRECEDING AND CURRENT ROW) as smoothed_speed
FROM winds
WHERE wind_source = 'Airmar_200WX'
ORDER BY time DESC LIMIT 100;

-=] Storm Signature:
- Pressure falling \(>2\) hPa/hour + Ground Wind increasing + Drift (current) shifting against the wind.
CREATE VIEW storm_warning AS
SELECT 
    w.time,
    w.wind_true_speed,
    t.temperature_value as pressure_hpa
FROM winds w
JOIN temperatures t ON t.time = w.time AND t.temperature_vessel_uuid = w.wind_vessel_uuid
WHERE t.temperature_source = 'Barometer'
  AND w.wind_true_speed > 12.0  -- ~23 knots
  AND t.temperature_value < 1000; -- Low pressure threshold

-=] Additional weather values calculated from other collected data;
CREATE OR REPLACE VIEW weather_enriched AS
SELECT 
    w.*,
    -- 1. Water Temp from the 'temperatures' table (linked by time and vessel)
    (SELECT t.temperature_value 
     FROM temperatures t 
     WHERE t.time = w.time 
       AND t.temperature_source = 'DST810' -- Adjust to your exact source name
     LIMIT 1) as water_temp,
    
    -- 2. Cloud Base (LCL) Calculation in meters
    -- Formula: (Air Temp - Dew Point) * 125
    ((w.weather_air_temp - w.weather_dew_point) * 125) as cloud_base_m,
    
    -- 3. Pressure Delta (Requires Index on Time)
    -- Calculates change over the previous 3 hours
    w.weather_pressure - LAG(w.weather_pressure) OVER (
        PARTITION BY w.weather_source 
        ORDER BY w.time
    ) as pressure_trend_3h
FROM weather w;
-- Like above, but using nearest neighbour in case the water temp and weather values don't have the same time stamp. Returns NULL if no match in temperatures is found.
CREATE OR REPLACE VIEW weather_enriched AS
SELECT 
    w.*,
    t.temperature_value AS water_temp,
    ((w.weather_air_temp - w.weather_dew_point) * 125) AS cloud_base_m
FROM weather w
LEFT JOIN LATERAL (
    SELECT temperature_value
    FROM temperatures
    WHERE temperature_source = 'DST810'
      -- 1. Apply the Max Delta (e.g., within 10 seconds)
      AND time BETWEEN w.time - INTERVAL '10 seconds' AND w.time + INTERVAL '10 seconds'
    -- 2. Sort by the absolute difference to find the CLOSEST
    ORDER BY ABS(EXTRACT(EPOCH FROM (time - w.time))) 
    LIMIT 1
) t ON TRUE;

-=] NMEA2000 PGN for tanks
- NMEA 2000 PGN for Tanks: 127505
The standard message for tanks is PGN 127505 (Fluid Level). When designing your STM32 firmware, you should know that this PGN actually transmits percentage as its primary dynamic field, with the capacity as an optional static field. 
Field 1: Instance (0–15)
Field 2: Fluid Type (0=Fuel, 1=Water, 2=Grey, 3=Live Well, 4=Oil, 5=Black)
Field 3: Fluid Level (percentage, 0 to 100%, with a resolution of 0.004%)
Field 4: Tank Capacity (liters, 4 bytes) 

-=] Calculating tank consumption
- May be useful for battery consumption as well. The example assumes diesel, but whatever.
-- Example: Calculate average fuel burn over the last hour
SELECT 
    (MAX(tank_level_litres) - MIN(tank_level_litres)) as litres_per_hour
FROM tanks
WHERE tank_type = 'diesel' 
  AND time > now() - interval '1 hour';

-=] Proprietary PGN (ie: tell that a sensor was calibrated)
- The Practical Way: PGN 126720 (Proprietary Fast-Packet) 
Since you are building your own hardware and daemon, the most effective way to log a "Tare" event is to use a Proprietary PGN. NMEA reserves PGNs in the 0xEF00 (61184) and 0x1EF00 (126720) range for manufacturers to send data that doesn't fit the standard. 
Implementation: Your STM32 can broadcast a small proprietary packet whenever the "Tare" button is pressed.
Perl Daemon: Your daemon on the Pi 4 will see this unique PGN and insert a record into your database's motion table or a dedicated events table.

-=] Find the closest location when a transmission occurred. Needs to be implemented in react to handle the changing timestamps from the rolling paritioned tables.
CREATE FUNCTION get_tx_with_location(start_time timestamptz, end_time timestamptz)
RETURNS TABLE(tx_time timestamptz, type text, lat float, lon float) AS $$
SELECT 
    vt.time AS tx_time, 
    vt.transmission_type, 
    m.location, 
    m.speed_over_ground,
    m.time AS motion_time,
    ABS(EXTRACT(EPOCH FROM (vt.time - m.time))) AS diff_seconds
FROM vessel_transmissions vt
CROSS JOIN LATERAL (
    -- Subquery to find the single closest record in the motions table
    SELECT time, location, speed_over_ground
    FROM motions
    WHERE motions.vessel_uuid = vt.vessel_uuid
      -- Optimization: Look within a small window to allow index usage
      AND motions.time BETWEEN vt.time - INTERVAL '5 seconds' AND vt.time + INTERVAL '5 seconds'
    ORDER BY vt.time <-> motions.time  -- Modern v18 distance operator for timestamps
    LIMIT 1
) m
WHERE vt.time BETWEEN '2026-01-12 00:00:00' AND '2026-01-12 23:59:59';
$$ LANGUAGE sql STABLE;
----
import { useQuery } from '@tanstack/react-query';

function TransmissionMap({ startTime, endTime }) {
  const { data, isLoading } = useQuery({
    queryKey: ['transmissions', startTime, endTime],
    queryFn: () => fetch(`/api/rpc/get_tx_with_location?start_time=${startTime}&end_time=${endTime}`).then(res => res.json()),
    refetchInterval: 10000, // Re-fetch every 10 seconds for "live" updates
  });

  if (isLoading) return <Spinner />;
  return <Map data={data} />;
}
----


#!/usr/bin/env python3
import math
import time
import struct
import can

# WGS84 Earth Radius in meters
EarthRadius = 6378137.0 

def calculate_bearing(latitude1, longitude1, latitude2, longitude2):
    """Calculate the initial compass bearing from point 1 to point 2."""
    latitude1, longitude1, latitude2, longitude2 = map(math.radians, [latitude1, longitude1, latitude2, longitude2])
    dest_longitude = longitude2 - longitude1
    y = math.sin(dest_longitude) * math.cos(latitude2)
    x = math.cos(latitude1) * math.sin(latitude2) - math.sin(latitude1) * math.cos(latitude2) * math.cos(dest_longitude)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def move_along_bearing(lat, lon, bearing, distance_m):
    """Push coordinates forward along the globe given a distance and bearing."""
    latitude1   = math.radians(lat)
    longitude1  = math.radians(lon)
    bearing_rad = math.radians(bearing)
    latitude2   = math.asin(math.sin(latitude1) * math.cos(distance_m / EarthRadius) +
                  math.cos(latitude1) * math.sin(distance_m / EarthRadius) * math.cos(bearing_rad))
    longitude2  = longitude1 + math.atan2(math.sin(bearing_rad) * math.sin(distance_m / EarthRadius) * math.cos(latitude1),
                  math.cos(distance_m / EarthRadius) - math.sin(latitude1) * math.sin(latitude2))
    return math.degrees(latitude2), math.degrees(longitude2)

def calculate_distance(latitude1, longitude1, latitude2, longitude2):
    """Calculate Haversine distance in meters between two points."""
    latitude1, longitude1, latitude2, longitude2 = map(math.radians, [latitude1, longitude1, latitude2, longitude2])
    dest_latitude  = latitude2 - latitude1
    dest_longitude = longitude2 - longitude1
    a              = math.sin(dest_latitude/2)**2 + math.cos(latitude1) * math.cos(latitude2) * math.sin(dest_longitude/2)**2
    return EarthRadius * (2 * math.asin(math.sqrt(a)))

def build_n2k_can_id(priority, pgn, source):
    """Bit-pack the 29-bit Extended NMEA 2000 CAN Identifier."""
    return (priority << 26) | (pgn << 8) | source

def send_pgn_129025(bus, latitude, longitude, source_address=42):
    """Broadcast Position, Rapid Update (PGN 129025)"""
    can_id        = build_n2k_can_id(2, 129025, source_address)
    latitude_raw  = int(latitude * 10_000_000)
    longitude_raw = int(longitude * 10_000_000)
    
    # Pack exactly as Rust expects: 2 signed 32-bit ints, little-endian
    data    = struct.pack('<ii', latitude_raw, longitude_raw)
    message = can.Message(arbitration_id=can_id, data=data, is_extended_id=True)
    bus.send(message)

def send_pgn_129026(bus, cog_deg, sog_knots, sid=0, source_address=42):
    """Broadcast Course/Speed over Ground, Rapid Update (PGN 129026)"""
    can_id  = build_n2k_can_id(2, 129026, source_address)
    cog_rad = cog_deg * (math.pi / 180)
    sog_mps = sog_knots * 0.514444
    
    # Pack: SID (u8), Ref (0xFC = True), COG (u16 rad), SOG (u16 mps), Reserved (0xFFFF)
    data    = struct.pack('<BBHHBB', sid, 0xFC, int(cog_rad / 0.0001), int(sog_mps / 0.01), 0xFF, 0xFF)
    message = can.Message(arbitration_id=can_id, data=data, is_extended_id=True)
    bus.send(message)

def main():
    print("Initializing NMEA 2000 Physics Engine...")
    bus = can.interface.Bus(channel='vcan0', bustype='socketcan')
    
    waypoints = []
    with open('route.txt', 'r') as f:
        for line in f:
            if not line.strip() or line.startswith('#'): continue
            latitude, longitude, speed = map(float, line.split(','))
            waypoints.append((latitude, longitude, speed))
            
    if len(waypoints) < 2:
        print("Error: Need at least 2 waypoints.")
        return

    current_lat, current_lon, _ = waypoints[0]
    target_idx  = 1
    update_rate = 0.1 # 10Hz tick rate
    sid         = 0

    print("Virtual vessel underway. Broadcasting to vcan0...")
    try:
        while target_idx < len(waypoints):
            target_lat, target_lon, target_speed = waypoints[target_idx]
            
            while True:
                dist_to_target = calculate_distance(current_lat, current_lon, target_lat, target_lon)
                if dist_to_target < 5.0: # Arrived within 5 meters
                    print(f"-> Reached Waypoint {target_idx}")
                    target_idx += 1
                    break
                    
                bearing   = calculate_bearing(current_lat, current_lon, target_lat, target_lon)
                dist_step = (target_speed * 0.514444) * update_rate
                
                # Mathematical movement
                current_lat, current_lon = move_along_bearing(current_lat, current_lon, bearing, dist_step)
                
                # Network injection
                send_pgn_129025(bus, current_lat, current_lon)
                send_pgn_129026(bus, bearing, target_speed, sid)
                
                sid = (sid + 1) % 256
                time.sleep(update_rate)
                
        print("Route Complete. Vessel stopped.")
    except KeyboardInterrupt:
        print("\nSimulation aborted by user.")

if __name__ == '__main__':
    main()

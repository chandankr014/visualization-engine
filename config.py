LOCATION="GURUGRAM, DELHI"
START_TIME=202507130155
END_TIME=202507140555
INTERVAL=5 # in minutes
CRS="EPSG4326"

MASTER_PMTILES_FILE = "pmtiles/flood/flood_depth_master.pmtiles"
DEPTH_PROPERTY_PREFIX = "D"


def generate_time_slots(start_time: int, end_time: int, interval_minutes: int) -> list:
    """
    Generate list of time slot property names based on start/end time and interval.
    
    Args:
        start_time: Start time in format YYYYMMDDHHmm (e.g., 202512101000)
        end_time: End time in format YYYYMMDDHHmm (e.g., 202512101500)
        interval_minutes: Interval between time slots in minutes
    
    Returns:
        List of property names like ['D202512101000', 'D202512101015', ...]
    """
    from datetime import datetime, timedelta
    
    # Parse start and end times
    start_str = str(start_time)
    end_str = str(end_time)
    
    start_dt = datetime.strptime(start_str, "%Y%m%d%H%M")
    end_dt = datetime.strptime(end_str, "%Y%m%d%H%M")
    
    time_slots = []
    current_dt = start_dt
    
    while current_dt <= end_dt:
        # Format: D{YYYYMMDDHHmm}
        prop_name = f"{DEPTH_PROPERTY_PREFIX}{current_dt.strftime('%Y%m%d%H%M')}"
        time_slots.append(prop_name)
        current_dt += timedelta(minutes=interval_minutes)
    print("TOTAL TIMESLOTS: ", len(time_slots))
    return time_slots


def get_time_slots() -> list:
    """Get all time slots based on configured START_TIME, END_TIME, and INTERVAL."""
    return generate_time_slots(START_TIME, END_TIME, INTERVAL)

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Application secrets from environment
GOOGLE_MAPS_API_KEY = os.getenv('GOOGLE_MAPS_API_KEY', '')

LOCATION="GURUGRAM, HARYANA"
START_TIME=202507130155
END_TIME=202507140555
INTERVAL=5  # in minutes
CRS="EPSG4326"

# Batch configuration for optimized PMTiles
# Each batch file contains BATCH_SIZE time slots with flood_depths array property
BATCH_SIZE = 48  # Number of time slots per batch file
BATCH_DURATION_HOURS = 4  # Each batch covers 4 hours (48 * 5 min = 240 min = 4 hours)
PMTILES_FLOOD_DIR = "pmtiles/flood"
DEPTH_PROPERTY_PREFIX = "D"

# Legacy - kept for backward compatibility
MASTER_PMTILES_FILE = "pmtiles/flood/flood_depth_master.pmtiles"


def parse_time(time_int: int):
    """Parse time integer to datetime object."""
    from datetime import datetime
    return datetime.strptime(str(time_int), "%Y%m%d%H%M")


def format_time(dt) -> str:
    """Format datetime to time string."""
    return dt.strftime("%Y%m%d%H%M")


def get_batch_start_times() -> list:
    """
    Get list of batch start times based on START_TIME, END_TIME, and BATCH_SIZE.
    Each batch covers BATCH_SIZE * INTERVAL minutes.
    
    Returns:
        List of batch start times as integers (e.g., [202507130200, 202507130600, ...])
    """
    from datetime import timedelta
    
    start_dt = parse_time(START_TIME)
    end_dt = parse_time(END_TIME)
    batch_duration = timedelta(minutes=BATCH_SIZE * INTERVAL)
    
    batch_starts = []
    current_dt = start_dt
    
    while current_dt < end_dt:
        batch_starts.append(int(format_time(current_dt)))
        current_dt += batch_duration
    
    return batch_starts


def get_batch_files() -> list:
    """
    Get list of batch PMTiles files with their time ranges.
    
    Returns:
        List of dicts with batch file info:
        [
            {
                "filename": "D202507130200.pmtiles",
                "startTime": 202507130200,
                "endTime": 202507130555,
                "startIndex": 0,
                "endIndex": 47,
                "path": "pmtiles/flood/D202507130200.pmtiles"
            },
            ...
        ]
    """
    from datetime import timedelta
    
    batch_starts = get_batch_start_times()
    batch_files = []
    
    for i, batch_start in enumerate(batch_starts):
        start_dt = parse_time(batch_start)
        # End time is (BATCH_SIZE - 1) intervals after start
        end_dt = start_dt + timedelta(minutes=(BATCH_SIZE - 1) * INTERVAL)
        
        filename = f"D{batch_start}.pmtiles"
        
        batch_files.append({
            "filename": filename,
            "startTime": batch_start,
            "endTime": int(format_time(end_dt)),
            "startIndex": i * BATCH_SIZE,
            "endIndex": (i + 1) * BATCH_SIZE - 1,
            "path": f"{PMTILES_FLOOD_DIR}/{filename}"
        })
    
    return batch_files


def get_batch_for_time_slot(time_slot_index: int) -> dict:
    """
    Get the batch file info and local index for a given global time slot index.
    
    Args:
        time_slot_index: Global index of the time slot (0-based)
    
    Returns:
        Dict with batch info and local index:
        {
            "batchFile": "D202507130200.pmtiles",
            "batchPath": "pmtiles/flood/D202507130200.pmtiles",
            "batchIndex": 0,  # Which batch (0, 1, 2, ...)
            "localIndex": 15, # Index within flood_depths array (0-47)
            "globalIndex": 15 # Original global index
        }
    """
    batch_index = time_slot_index // BATCH_SIZE
    local_index = time_slot_index % BATCH_SIZE
    
    batch_files = get_batch_files()
    
    if batch_index >= len(batch_files):
        batch_index = len(batch_files) - 1
        local_index = BATCH_SIZE - 1
    
    batch = batch_files[batch_index]
    
    return {
        "batchFile": batch["filename"],
        "batchPath": batch["path"],
        "batchIndex": batch_index,
        "localIndex": local_index,
        "globalIndex": time_slot_index
    }


def get_time_slot_info(time_slot_index: int) -> dict:
    """
    Get complete info about a time slot including timestamp and batch details.
    
    Args:
        time_slot_index: Global index of the time slot (0-based)
    
    Returns:
        Dict with complete time slot info
    """
    from datetime import timedelta
    
    start_dt = parse_time(START_TIME)
    slot_dt = start_dt + timedelta(minutes=time_slot_index * INTERVAL)
    
    batch_info = get_batch_for_time_slot(time_slot_index)
    
    return {
        "index": time_slot_index,
        "timestamp": int(format_time(slot_dt)),
        "timestampFormatted": slot_dt.strftime("%d/%m/%Y %H:%M"),
        "propertyName": f"{DEPTH_PROPERTY_PREFIX}{format_time(slot_dt)}",
        **batch_info
    }


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


def get_total_time_slots() -> int:
    """Get total number of time slots."""
    return len(get_time_slots())

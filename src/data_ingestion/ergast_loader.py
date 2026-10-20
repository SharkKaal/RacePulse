from fastf1.ergast import Ergast
import pandas as pd

# Initialize Ergast API interface
ergast = Ergast()

def get_historical_driver_standings(start_year: int, end_year: int):
    """
    Fetches driver championship standings across a range of years.
    Returns a dataframe of driver, year, and total points.
    """
    all_standings = []
    for year in range(start_year, end_year + 1):
        try:
            standings = ergast.get_driver_standings(season=year)
            if standings.content:
                df = standings.content[0]
                df['year'] = year
                all_standings.append(df[['driverId', 'points', 'position', 'year']])
        except Exception as e:
            print(f"Failed to fetch {year}: {e}")
            
    if all_standings:
        return pd.concat(all_standings, ignore_index=True)
    return pd.DataFrame()

def get_pit_stops_vs_position(year: int, round_num: int):
    """
    Fetches pit stop durations and final race positions for a specific race.
    """
    try:
        # Get race results for final positions
        results_res = ergast.get_race_results(season=year, round=round_num)
        if not results_res.content:
            return pd.DataFrame()
        results_df = results_res.content[0][['driverId', 'position', 'status']]
        
        # Get pit stops
        pit_res = ergast.get_pit_stops(season=year, round=round_num)
        if not pit_res.content:
            return pd.DataFrame()
        pit_df = pit_res.content[0][['driverId', 'stop', 'lap', 'duration']]
        
        # Merge pit stop duration with final position
        merged = pd.merge(pit_df, results_df, on='driverId', how='left')
        return merged
    except Exception as e:
        print(f"Error fetching pitstops for {year} round {round_num}: {e}")
        return pd.DataFrame()
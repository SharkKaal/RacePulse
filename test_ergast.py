from fastf1.ergast import Ergast

try:
    ergast = Ergast()
    res = ergast.get_race_results(season=2023, round=1)
    print("Ergast fastf1 works")
    print(res.content[0].head(1))
except Exception as e:
    print(f"Error: {e}")

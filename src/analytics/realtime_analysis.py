def compare_drivers(session, driver1: str, driver2: str):
    """
    Compare fastest lap telemetry between two drivers in a FastF1 session.
    """
    driver1_laps = session.laps.pick_drivers(driver1)
    driver2_laps = session.laps.pick_drivers(driver2)

    lap1 = driver1_laps.pick_fastest()
    lap2 = driver2_laps.pick_fastest()

    tel1 = lap1.get_telemetry()
    tel2 = lap2.get_telemetry()

    return tel1, tel2
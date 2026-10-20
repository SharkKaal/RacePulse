import matplotlib.pyplot as plt
import numpy as np


def plot_speed(distance, speed, driver="Driver"):
    plt.figure(figsize=(10, 5))
    plt.plot(distance, speed)
    plt.title(f"Speed vs Distance ({driver})")
    plt.xlabel("Distance")
    plt.ylabel("Speed")
    plt.grid()
    plt.show()


def compare_drivers(distance1, speed1, driver1,
                    distance2, speed2, driver2):

    plt.figure(figsize=(12, 6))
    plt.plot(distance1, speed1, label=driver1)
    plt.plot(distance2, speed2, label=driver2)

    plt.title(f"{driver1} vs {driver2} - Speed Comparison")
    plt.xlabel("Distance")
    plt.ylabel("Speed")

    plt.legend()
    plt.grid()
    plt.show()


def plot_delta_time(distance1, speed1,
                    distance2, speed2,
                    driver1, driver2):

    # --- COMMON DISTANCE ---
    common_distance = np.linspace(
        max(distance1.min(), distance2.min()),
        min(distance1.max(), distance2.max()),
        1000
    )

    # --- INTERPOLATION ---
    speed1_interp = np.asarray(np.interp(common_distance, distance1, speed1))
    speed2_interp = np.asarray(np.interp(common_distance, distance2, speed2))

    # --- CONVERT TO m/s ---
    speed1_ms = speed1_interp / 3.6
    speed2_ms = speed2_interp / 3.6

    # --- TIME CALCULATION ---
    dt1 = np.cumsum(np.diff(common_distance) / speed1_ms[:-1])
    dt2 = np.cumsum(np.diff(common_distance) / speed2_ms[:-1])

    dt1 = np.insert(dt1, 0, 0)
    dt2 = np.insert(dt2, 0, 0)

    delta = dt1 - dt2

    # --- PLOTTING ---
    plt.figure(figsize=(14, 7))

    plt.plot(common_distance, delta, color='black', linewidth=2)

    plt.fill_between(common_distance, delta, 0,
                     where=(delta < 0),
                     color='#1f77b4', alpha=0.35,
                     interpolate=True,
                     label=f"{driver1} faster")

    plt.fill_between(common_distance, delta, 0,
                     where=(delta > 0),
                     color='#ff7f0e', alpha=0.35,
                     interpolate=True,
                     label=f"{driver2} faster")

    plt.axhline(0, linestyle='--', color='black')

    # 🔥 Highlights
    plt.scatter(common_distance[np.argmin(delta)],
                np.min(delta),
                color='red', s=60, label='Max gain')

    plt.scatter(common_distance[np.argmax(delta)],
                np.max(delta),
                color='green', s=60, label='Max loss')

    plt.xlabel("Distance (m)")
    plt.ylabel("Delta Time (s)")
    plt.title(f"{driver1} vs {driver2} — Delta Time Analysis (Fastest Lap)")

    plt.legend()
    plt.grid(True, linestyle='--', alpha=0.4)

    plt.show()

def plot_driver_inputs(distance1, throttle1, brake1,
                       distance2, throttle2, brake2,
                       driver1, driver2):

    plt.figure(figsize=(14, 8))

    # --- THROTTLE ---
    plt.subplot(2, 1, 1)
    plt.plot(distance1, throttle1, label=f"{driver1} Throttle", color='blue')
    plt.plot(distance2, throttle2, label=f"{driver2} Throttle", color='orange')
    plt.ylabel("Throttle (%)")
    plt.title("Throttle Comparison")
    plt.legend()
    plt.grid()

    # --- BRAKE ---
    plt.subplot(2, 1, 2)
    plt.plot(distance1, brake1, label=f"{driver1} Brake", color='blue')
    plt.plot(distance2, brake2, label=f"{driver2} Brake", color='orange')
    plt.ylabel("Brake")
    plt.xlabel("Distance (m)")
    plt.title("Brake Comparison")
    plt.legend()
    plt.grid()

    plt.tight_layout()
    plt.show()

def plot_full_comparison(
    tel1, tel2,
    driver1, driver2
):
    # Extract data
    d1, s1 = tel1["Distance"], tel1["Speed"]
    d2, s2 = tel2["Distance"], tel2["Speed"]

    # --- COMMON DISTANCE ---
    common_distance = np.linspace(
        max(d1.min(), d2.min()),
        min(d1.max(), d2.max()),
        1000
    )

    # Interpolate
    s1_i = np.asarray(np.interp(common_distance, d1, s1))
    s2_i = np.asarray(np.interp(common_distance, d2, s2))

    # Convert to m/s
    s1_ms = s1_i / 3.6
    s2_ms = s2_i / 3.6

    # --- DELTA TIME ---
    dt1 = np.cumsum(np.diff(common_distance) / s1_ms[:-1])
    dt2 = np.cumsum(np.diff(common_distance) / s2_ms[:-1])

    dt1 = np.insert(dt1, 0, 0)
    dt2 = np.insert(dt2, 0, 0)

    delta = dt1 - dt2

    # --- FIGURE ---
    plt.figure(figsize=(14, 10))

    # =========================
    # =========================
    plt.subplot(3, 1, 1)
    plt.plot(d1, s1, label=driver1, color='blue')
    plt.plot(d2, s2, label=driver2, color='orange')
    plt.title("Speed Comparison")
    plt.ylabel("Speed")
    plt.legend()
    plt.grid()

    # =========================
    # =========================
    plt.subplot(3, 1, 2)
    plt.plot(common_distance, delta, color='white')

    plt.fill_between(common_distance, delta, 0,
                     where=(delta < 0),
                     color='blue', alpha=0.3,
                     label=f"{driver1} faster")

    plt.fill_between(common_distance, delta, 0,
                     where=(delta > 0),
                     color='orange', alpha=0.3,
                     label=f"{driver2} faster")

    plt.axhline(0, linestyle='--', color='black')
    plt.ylabel("Delta (s)")
    plt.title("Delta Time")
    plt.legend()
    plt.grid()

    # =========================
    # =========================
    plt.subplot(3, 1, 3)

    plt.plot(tel1["Distance"], tel1["Throttle"],
             color='blue', linestyle='-', label=f"{driver1} Throttle")

    plt.plot(tel2["Distance"], tel2["Throttle"],
             color='orange', linestyle='-', label=f"{driver2} Throttle")

    plt.plot(tel1["Distance"], tel1["Brake"],
             color='blue', linestyle='--', label=f"{driver1} Brake")

    plt.plot(tel2["Distance"], tel2["Brake"],
             color='orange', linestyle='--', label=f"{driver2} Brake")

    plt.xlabel("Distance (m)")
    plt.ylabel("Input")
    plt.title("Throttle & Brake")
    plt.legend()
    plt.grid()

    plt.tight_layout()
    plt.show()


plot_speed_comparison = plot_full_comparison

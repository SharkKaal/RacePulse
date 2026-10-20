def add_speed_features(telemetry):
    telemetry['acceleration'] = telemetry['Speed'].diff()
    return telemetry


def compute_brake_intensity(telemetry):
    telemetry['brake_intensity'] = telemetry['Brake'] * telemetry['Speed']
    return telemetry
import plotly.graph_objects as go

def plot_track_3d(telemetry):
    fig = go.Figure(data=[go.Scatter3d(
        x=telemetry['X'],
        y=telemetry['Y'],
        z=telemetry['Speed'],
        mode='lines',
        line=dict(color=telemetry['Speed'], colorscale='Viridis')
    )])

    fig.show()
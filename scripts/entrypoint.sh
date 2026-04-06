#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

echo "--- Starting Entrypoint Script ---"

# 1. Standard Static Collection
# Note: We do this here as well to ensure shared volumes (static_volume) 
# are fully populated if they were empty on the host.
echo "Collecting static files..."
python manage.py collectstatic --noinput

# 2. Custom Initialization Command
echo "Running custom project initialization..."
python manage.py initialize_project

# 3. Start Gunicorn
# Use 'exec' so Gunicorn becomes PID 1 and correctly handles Unix signals
echo "Starting Gunicorn on port ${APP_PORT}..."
exec gunicorn config.wsgi:application \
     --bind 0.0.0.0:${APP_PORT} \
     --worker-tmp-dir /tmp/gunicorn \
     --workers 3
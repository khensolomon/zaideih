#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

echo "--- Starting Entrypoint Script ---"

# 1. Standard Static Collection
# echo "Collecting static files..."
python manage.py collectstatic --noinput

# 2. Custom Initialization Command
echo "Running custom project initialization..."
python manage.py initialize_project

# 3. Handle Command Overrides
# This is the fix! If a command is passed to 'docker run' (like migrate),
# we execute that command instead of starting Gunicorn.
if [ "$#" -gt 0 ]; then
    echo "Executing override command: $@"
    exec "$@"
fi

# 4. Default: Start Gunicorn
echo "No command provided, starting Gunicorn on port ${APP_PORT}..."
exec gunicorn config.wsgi:application \
     --bind 0.0.0.0:${APP_PORT} \
     --worker-tmp-dir /tmp/gunicorn \
     --workers 3
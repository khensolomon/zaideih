# Setup

```bash
# sudo snap install docker
# sudo snap install docker-compose

cd /home/<username>/dev/zaideih

# 1. See what services will start
docker compose config

# 2. (Optional but safer) Build first so you see any build errors separately
docker compose build

# 3. Then start in detached mode
docker compose up -d


# Stop and remove the old containers
docker compose down

# After cleaning, you can start fresh with the corrected docker-compose.yml:
docker compose up -d --build
```

## Directory

```bash
# 1. Create the directory
sudo mkdir -p /var/www/zaideih

# 2. Give ownership to your 'web' user
sudo chown -R web:web /var/www/zaideih
# chown: invalid user: ‘web:web’

# 3. Set correct permissions so Docker and Git can work
sudo chmod -R 755 /var/www/zaideih
```

## Create a dedicated web user

```bash
# Create the user (and group automatically)
sudo adduser --system --group web
# What this does:
# Creates user: web
# Creates group: web
# No login shell (good for services)
# System user (UID < 1000)

# Verify it exists
id web

# You should see something like:
uid=xxx(web) gid=xxx(web)

# Apply ownership again
sudo chown -R web:web /var/www/zaideih
```


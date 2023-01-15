#!/bin/bash

# Create symbolic link, and update nginx config
# ln -s /var/www/zaideih-src/current /var/www/zaideih

# Copy to
# cp webhook.sh /var/www/webhook/update-zaideih.sh

# Make it executable
# chmod +x /var/www/webhook/update-zaideih.sh
# And then modify /etc/webhook.conf

# git update-index --chmod=+x webhook.sh

# Update repo
git pull -f origin master

# Install dependencies
npm install
# Build assets
npm run build

# Reload PM2
# pm2 startOrRestart ecosystem.json
pm2 reload zaideih
# Save PM2
pm2 save

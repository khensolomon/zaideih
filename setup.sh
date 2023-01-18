#!/bin/bash

# 1.1 Create symbolic link, and update nginx config
# ln -s /var/www/zaideih-src/current /var/www/zaideih

# 1.2 Transfer .env to production
# scp ~/OneDrive/env/dev/zaideih/web/.env user@host:/var/www/zaideih/
node run environment


# 2.1 Install dependencies
cd /var/www/zaideih
npm install

# 2.2 Build ecosystem.json for pm2
node run ecosystem
# npm run ecosystem

# 2.2 Build assets
npm run build

# 2.3 Start PM2
pm2 start ecosystem.json
# pm2 startOrRestart ecosystem.json
# pm2 reload zaideih

# 2.4 Save PM2
pm2 save

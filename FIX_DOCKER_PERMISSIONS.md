# Fix Docker Permissions

**Issue:** `permission denied while trying to connect to the Docker daemon socket`

## Quick Fix (Run These Commands)

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Activate the new group membership (avoid logout/login)
newgrp docker

# Verify it works
docker ps

# If docker ps works, run the tests
cd /home/arson/builds/piptip
npm run test:setup && ./RUN_ALL_TESTS.sh
```

## Alternative: Use sudo for this session

If you want to run tests immediately without logging out:

```bash
# Run setup with sudo
sudo npm run test:setup

# Run tests with sudo
sudo ./RUN_ALL_TESTS.sh
```

## What Happened

- Docker daemon is running ✅
- Your user (`arson`) doesn't have permission to access `/var/run/docker.sock`
- Need to add user to `docker` group for non-root access

## Recommended Approach

**Option 1: Fix permissions (best long-term)**
```bash
sudo usermod -aG docker $USER
newgrp docker
npm run test:setup && ./RUN_ALL_TESTS.sh
```

**Option 2: Use sudo for now (quick)**
```bash
sudo npm run test:setup && sudo ./RUN_ALL_TESTS.sh
```

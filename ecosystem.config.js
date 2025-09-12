module.exports = {
  apps: [{
    name: 'piptip-bot',
    script: 'src/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    cwd: process.cwd(),
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 5000,
    min_uptime: '10s'
  }]
};
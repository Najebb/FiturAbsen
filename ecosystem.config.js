module.exports = {
  apps: [
    {
      name: 'absensi-simkuliah',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};

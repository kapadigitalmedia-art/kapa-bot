function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = {
  info: (...args) => console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${ts()}] [ERROR]`, ...args),
};

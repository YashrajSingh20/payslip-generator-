/** Structured one-line JSON logs to stdout (collected by CloudWatch in AWS). */
export function createLogger({ write = (line) => process.stdout.write(`${line}\n`), base = {} } = {}) {
  const emit = (level, event, fields = {}) => {
    const entry = { level, event, time: new Date().toISOString(), ...base, ...fields };
    if (fields.error instanceof Error) {
      entry.error = { message: fields.error.message, name: fields.error.name, stack: fields.error.stack };
    }
    write(JSON.stringify(entry));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createLogger({ write, base: { ...base, ...extra } }),
  };
}

export const silentLogger = { info() {}, warn() {}, error() {}, child: () => silentLogger };

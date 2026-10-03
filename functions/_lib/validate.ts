// A deliberately small schema validator. Each schema is a function that
// returns the parsed value or throws a ValidationError naming the field.
import { badRequest } from './http';

export type Schema<T> = (value: unknown, path: string) => T;
export type Infer<S> = S extends Schema<infer T> ? T : never;

class ValidationError extends Error {
  constructor(public path: string, message: string) {
    super(message);
  }
}

const fail = (path: string, msg: string): never => {
  throw new ValidationError(path, msg);
};

export function parse<T>(schema: Schema<T>, value: unknown): T {
  try {
    return schema(value, '');
  } catch (e) {
    if (e instanceof ValidationError) {
      const field = e.path.replace(/^\./, '') || 'body';
      throw badRequest(`${field}: ${e.message}`, { field });
    }
    throw e;
  }
}

export const v = {
  string(opts: { min?: number; max?: number; trim?: boolean; pattern?: RegExp } = {}): Schema<string> {
    const { min = 0, max = 1000, trim = true, pattern } = opts;
    return (val, path) => {
      if (typeof val !== 'string') return fail(path, 'must be text');
      const s = trim ? val.trim() : val;
      if (s.length < min) return fail(path, min === 1 ? 'is required' : `must be at least ${min} characters`);
      if (s.length > max) return fail(path, `must be at most ${max} characters`);
      if (pattern && !pattern.test(s)) return fail(path, 'has an invalid format');
      return s;
    };
  },

  email(): Schema<string> {
    const base = v.string({ min: 3, max: 254 });
    return (val, path) => {
      const s = base(val, path).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return fail(path, 'must be a valid email');
      return s;
    };
  },

  number(opts: { min?: number; max?: number; int?: boolean } = {}): Schema<number> {
    const { min = -Infinity, max = Infinity, int = false } = opts;
    return (val, path) => {
      if (typeof val !== 'number' || !Number.isFinite(val)) return fail(path, 'must be a number');
      if (int && !Number.isInteger(val)) return fail(path, 'must be a whole number');
      if (val < min) return fail(path, `must be at least ${min}`);
      if (val > max) return fail(path, `must be at most ${max}`);
      return val;
    };
  },

  boolean(): Schema<boolean> {
    return (val, path) => (typeof val === 'boolean' ? val : fail(path, 'must be true or false'));
  },

  /** Calendar date as YYYY-MM-DD. */
  date(): Schema<string> {
    return (val, path) => {
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return fail(path, 'must be a date (YYYY-MM-DD)');
      const d = new Date(val + 'T00:00:00Z');
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) return fail(path, 'must be a real date');
      return val;
    };
  },

  enum<const T extends readonly string[]>(values: T): Schema<T[number]> {
    return (val, path) =>
      typeof val === 'string' && (values as readonly string[]).includes(val)
        ? (val as T[number])
        : fail(path, `must be one of: ${values.join(', ')}`);
  },

  optional<T>(schema: Schema<T>): Schema<T | undefined> {
    return (val, path) => (val === undefined ? undefined : schema(val, path));
  },

  nullable<T>(schema: Schema<T>): Schema<T | null> {
    return (val, path) => (val === null ? null : schema(val, path));
  },

  array<T>(item: Schema<T>, opts: { max?: number } = {}): Schema<T[]> {
    const { max = 100 } = opts;
    return (val, path) => {
      if (!Array.isArray(val)) return fail(path, 'must be a list');
      if (val.length > max) return fail(path, `must have at most ${max} items`);
      return val.map((x, i) => item(x, `${path}[${i}]`));
    };
  },

  object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }> {
    return (val, path) => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return fail(path, 'must be an object');
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const parsed = shape[key]((val as Record<string, unknown>)[key], `${path}.${key}`);
        if (parsed !== undefined) out[key] = parsed;
      }
      return out as { [K in keyof S]: Infer<S[K]> };
    };
  },
};

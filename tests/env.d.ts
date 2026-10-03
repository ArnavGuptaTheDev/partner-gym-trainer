declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PHOTOS: R2Bucket;
    SUPER_USER_EMAILS?: string;
    ALLOWED_ORIGINS?: string;
  }
}

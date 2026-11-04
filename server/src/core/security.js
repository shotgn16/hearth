// Browser-side lock-down: only Hearth's own code runs, nothing loads from elsewhere, no framing by other sites.
// If you add a feature that loads something from another site, this Content Security Policy is where to allow it.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self' data:", "object-src 'none'", "frame-src 'self' blob:", "frame-ancestors 'self'",
  "base-uri 'self'", "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // financial data is never cached
  next();
}

module.exports = { securityHeaders, CSP };

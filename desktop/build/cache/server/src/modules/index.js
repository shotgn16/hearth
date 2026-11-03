// The list of feature modules Hearth loads, in order.
//
// A module is a folder with an index.js that exports:
//   name           short id, e.g. 'prices'
//   title          what it is, for people reading the code
//   publicRoutes   (optional) function(api) — routes that work before signing in
//   routes         function(api) — routes for signed-in users (req.user and req.hid are set)
//
// To add a feature, create modules/<your-feature>/index.js and add it below.
// To take one out, remove its line (and its screen in web/js). See docs/customising.md.
module.exports = [
  require('./auth'),
  require('./household'),
  require('./transactions'),
  require('./import'),
  require('./banks'),
  require('./tracker'),
  require('./email'),
  require('./expenses'),
  require('./workflows'),
  require('./planning'),
  require('./insights'),
  require('./calendar'),
  require('./notes'),
  require('./ai'),
  require('./prices'),
  require('./notifications'),
  require('./settings'),
  require('./homeassistant'),
  require('./backup'),
  require('./devices'),
];

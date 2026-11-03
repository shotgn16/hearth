// Household — People you spend on, accounts, categories and tags.
// Each module adds its API routes here; see docs/customising.md.
const { crud } = require('../../core/http');

// Routes for signed-in users
function routes(api) {
  crud(api, 'people', ['name', 'color', 'user_id'], { order: 'name' });
  crud(api, 'accounts', ['owner_user_id', 'name', 'institution', 'type', 'currency', 'balance', 'balance_date', 'color', 'shared', 'archived'], { order: 'archived, name' });
  crud(api, 'categories', ['name', 'parent_id', 'color', 'icon', 'kind'], { order: 'kind DESC, name' });
  crud(api, 'tags', ['name', 'color'], { order: 'name' });
}

module.exports = { name: 'household', title: 'Household', routes };

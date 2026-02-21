const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  try {
    const bosses = JSON.parse(event.body);
    const bossesPath = path.join(__dirname, '../../bosses.json');
    fs.writeFileSync(bossesPath, JSON.stringify(bosses, null, 2));
    return {
      statusCode: 200,
      body: 'Bosses updated',
    };
  } catch (err) {
    return {
      statusCode: 400,
      body: 'Invalid data',
    };
  }
};

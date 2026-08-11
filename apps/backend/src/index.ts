import "dotenv/config";

import { getConfig } from "./config.js";
import { createServer } from "./server.js";

const config = getConfig();
const server = await createServer(config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}


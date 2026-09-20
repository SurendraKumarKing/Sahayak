import { DefaultAzureCredential } from "@azure/identity";
import { Api } from "./app.js";
import { AzureServices } from "./azure.js";
import { loadConfig } from "./config.js";
import { DemoServices } from "./services.js";
import { AzureStore, MemoryStore } from "./store.js";

export function createApi() {
  const config = loadConfig();
  if (config.mode === "demo") return new Api(config, new DemoServices(), new MemoryStore());
  const credential = new DefaultAzureCredential();
  return new Api(config, new AzureServices(config, credential), new AzureStore(config.values.AZURE_STORAGE_ACCOUNT_URL, config.values.AZURE_STORAGE_CONTAINER, credential));
}

import Router from "@koa/router";
import {contractsRoute} from "./routes/contractsRoute";
import {interactionsRoute} from "./routes/interactionsRoute";
import {searchRoute} from "./routes/searchRoute";
import {statsTotalInteractionsRoute} from "./routes/stats/statsTotalInteractionsRoute";
import {statsTxPerDayRoute} from "./routes/stats/statsTxPerDayRoute";
import {statsContractsPerMonthRoute} from "./routes/stats/statsContractsPerMonth";
import {statsTagsRoute} from "./routes/stats/statsTagsRoute";
import {contractRoute} from "./routes/contractRoute";
import {interactionRoute} from "./routes/interactionRoute";
import {safeContractsRoute} from "./routes/safeContractsRoute";

const gatewayRouter = new Router({prefix: '/gateway'});

gatewayRouter.get("/contracts", contractsRoute);
gatewayRouter.get("/contracts/:id", contractRoute);
gatewayRouter.get("/contracts-safe", safeContractsRoute);
gatewayRouter.get("/search/:phrase", searchRoute);
gatewayRouter.get("/interactions", interactionsRoute);
gatewayRouter.get("/interactions/:id", interactionRoute);
gatewayRouter.get("/stats/total", statsTotalInteractionsRoute);
gatewayRouter.get("/stats/tx-per-day", statsTxPerDayRoute);
gatewayRouter.get("/stats/contracts-per-month", statsContractsPerMonthRoute);
gatewayRouter.get("/stats/tags", statsTagsRoute);

export default gatewayRouter;

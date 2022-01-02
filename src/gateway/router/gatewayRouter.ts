import Router from "@koa/router";
import {contractsRoute} from "./routes/contractsRoute";
import {interactionsRoute} from "./routes/interactionsRoute";
import {searchRoute} from "./routes/searchRoute";
import {statsRoute} from "./routes/statsRoute";

const gatewayRouter = new Router({prefix: '/gateway'});

gatewayRouter.get("/contracts", contractsRoute);
gatewayRouter.get("/search/:phrase", searchRoute);
gatewayRouter.get("/interactions", interactionsRoute);
gatewayRouter.get("/stats", statsRoute);

export default gatewayRouter;

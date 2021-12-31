import Router from "@koa/router";
import {contractsRoute} from "./routes/contractsRoute";
import {interactionsRoute} from "./routes/interactionsRoute";
import {searchRoute} from "./routes/searchRoute";

const gatewayRouter = new Router({prefix: '/gateway'});

gatewayRouter.get("/contracts", contractsRoute);
gatewayRouter.get("/search/:phrase", searchRoute);
gatewayRouter.get("/interactions", interactionsRoute);

export default gatewayRouter;

import Router from "@koa/router";
import {contractsRoute} from "./contractsRoute";
import {interactionsRoute} from "./interactionsRoute";

const gatewayRouter = new Router({prefix: '/gateway'});

gatewayRouter.get("/contracts", contractsRoute);
gatewayRouter.get("/interactions", interactionsRoute);

export default gatewayRouter;

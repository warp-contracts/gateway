import Router from "@koa/router";
import {otherPeers, peersRoute} from "./peersRoute";
import {registerRoute} from "./registerRoute";
import {unregisterRoute} from "./unregisterRoute";

const networkRouter = new Router({prefix: '/network'});

networkRouter.get("/peers", peersRoute);
networkRouter.get("/other-peers", otherPeers);
networkRouter.post("/register", registerRoute);
networkRouter.post("/unregister", unregisterRoute);

export default networkRouter;

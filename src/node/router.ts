import Router from "@koa/router";
import { gossipRoute } from "./routes/gossip";
import { infoRoute } from "./routes/info";
import { currentState } from "./routes/currentState";

const router = new Router();

router.get("/info", infoRoute);
router.post("/current-state", currentState);
router.post("/gossip", gossipRoute);
// TODO: /graphql

export default router;

import Router from "@koa/router";
import {otherPeers, peers} from "./routes/peers";
import { register } from "./routes/register";
import { unregister } from "./routes/unregister";

const networkRouter = new Router();

networkRouter.get("/peers", peers);
networkRouter.get("/other-peers", otherPeers);
networkRouter.post("/register", register);
networkRouter.post("/unregister", unregister);

export default networkRouter;

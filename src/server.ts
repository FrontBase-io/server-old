const express = require("express");
const path = require("path");
var cors = require("cors");
const fs = require("fs");
const port = process.env.PORT || 8600;
import { Interactor } from "frontbase-server-utils";
import { MongoClient, ObjectId } from "mongodb";
import {
  checkUserToken,
  hashPassword,
} from "frontbase-server-utils/dist/Interactor/Functions/UserSecurity";
import { ApiConnectionType, UserObjectType } from "./Utils/Types";
import executeReadApi from "./API/Read";
import { find, findKey } from "lodash";
require("dotenv").config();
const fileUpload = require("express-fileupload");
var shell = require("shelljs");

// Start up server
const app = express();
app.set("port", port);
let http = require("http").Server(app);

const whitelist = [
  "http://localhost:8600",
  "http://localhost:3000",
  process.env.PUBLICURL,
];
const clientBuildPath = "/opt/frontbase/system/client/build";

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  })
);
let io = require("socket.io")(http, {
  cors: {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  },
});
app.use(
  fileUpload({
    createParentPath: true,
  })
);

// Serve uploaded files
app.use("/files", express.static("/opt/frontbase/files/objects"));
app.use("/public", express.static("/opt/frontbase/files/public"));

// API
app.use("/api/:modelKey/:action", async (req, res) => {
  const uri = "mongodb://" + process.env.DBURL + "&appname=Frontbase%20Server";
  const client: MongoClient = new MongoClient(uri, {
    //@ts-ignore
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  const db = client.db("FrontBase");

  if (req.query.apiKey) {
    // API key action
    const apiKeys = await db
      .collection("systemsettings")
      .findOne({ key: "api-keys" });
    const apiKey = findKey(apiKeys.value, (o) => o.apiKey === req.query.apiKey);
    if (apiKey) {
      switch (req.params.action) {
        case "read":
          executeReadApi({ permission: `api-${apiKey}` }, db, req, res);
          break;
        default:
          res.send(`Unknown API method ${req.params.action}`);
          break;
      }
    } else {
      res.sendStatus(400);
    }
  } else {
    // Public action
    switch (req.params.action) {
      case "read":
        executeReadApi({ permission: "everybody" }, db, req, res);
        break;
      default:
        res.send(`Unknown API method ${req.params.action}`);
        break;
    }
  }
});
// File upload
app.post("/upload", async (req, res) => {
  try {
    if (!req.files) {
      res.send({
        status: false,
        message: "No file uploaded",
      });
    } else {
      //Use the name of the input field (i.e. "avatar") to retrieve the uploaded file
      const file = req.files.file;
      const objectId = req.body.objectId;
      const username = req.body.username;
      const token = req.body.token;

      const uri =
        "mongodb://" + process.env.DBURL + "&appname=Frontbase%20Server";
      const client: MongoClient = new MongoClient(uri, {
        //@ts-ignore
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      await client.connect();
      const db = client.db("FrontBase");
      const user = (await db.collection("objects").findOne({
        "meta.model": "user",
        username: username,
      })) as UserObjectType;

      if (checkUserToken(token, user)) {
        const object = await db
          .collection("objects")
          .findOne({ _id: new ObjectId(objectId) });
        if (object) {
          const path = `../../files/objects/${object.meta.model}/${object._id}`;
          shell.mkdir("-p", path);

          file.mv(`${path}/${file.name}`);

          //send response
          res.send({
            status: true,
            message: "File is uploaded",
            data: {
              path: `/files/${object.meta.model}/${object._id}/${file.name}`,
            },
          });
        } else {
          res
            .status(500)
            .send({ success: false, reason: "object-doesnt-exist" });
        }
      } else {
        res.status(500).send({ success: false, reason: "wrong-token" });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});
// Register certain critical build files so it doesn't redirect to the app
app.use("/static", express.static(`${clientBuildPath}/static`));
app.use(express.static(clientBuildPath));
app.use(express.static("public"));

app.use((req, res, next) => {
  res.sendFile(`${clientBuildPath}/index.html`);
});

http.listen(port, () => {
  async function main() {
    const uri =
      "mongodb://" + process.env.DBURL + "&appname=Frontbase%20Server";
    const client: MongoClient = new MongoClient(uri, {
      //@ts-ignore
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    try {
      await client.connect();
      const db = client.db("FrontBase");

      // See if any users are registered. If not, open the server in a limited mode
      const firstUser = await db
        .collection("objects")
        .findOne({ "meta.model": "user" });

      console.log(`FrontBase is now live at http://localhost:${port}`);

      if (!firstUser) {
        console.log(
          "No users in the system yet! Opening a limited interactor to register the first user."
        );
        io.on("connection", (socket) => {
          socket.emit("mode set to onboard");

          socket.on("createInitialUser", async (user, callback) => {
            // First create the new user
            const now = new Date();
            const newUser = await (
              await db.collection("objects").insertOne({
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                username: user.username,
                password: hashPassword(user.password),
                roles: ["6118f070375e274ce6ace551", "6118f070375e274ce6ace552"],
              })
            ).insertedId;
            // Then update the meta to self reference
            db.collection("objects").updateOne(
              { _id: newUser },
              {
                $set: {
                  meta: {
                    createdOn: now,
                    lastModifiedOn: now,
                    model: "user",
                    createdBy: newUser,
                    lastModifiedBy: newUser,
                    owner: newUser,
                  },
                },
              }
            );

            callback({
              result: "success",
            });
          });
        });
      } else {
        console.log("FrontBase is ready to go!");

        // Socket
        io.on("connection", (socket) => {
          let interactor = new Interactor(socket, db);
          socket.on("disconnect", () => (interactor = null)); // Cleanup is important because this variable hosts listeners that perform DB queries.
        });
      }
    } catch (e) {
      console.error("Error state", e);
    }
  }
  main();
});

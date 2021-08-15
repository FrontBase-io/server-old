const express = require("express");
const path = require("path");
var cors = require("cors");
const fs = require("fs");
const port = process.env.PORT || 8600;
import Interactor from "./Interactor";
import { MongoClient } from "mongodb";
import { hashPassword } from "./Utils/Functions/UserSecurity";

// Start up server
const app = express();
app.set("port", port);
let http = require("http").Server(app);

const whitelist = ["http://localhost:8600", "http://localhost:3000"];
app.use(
  cors({
    credentials: true, // This is important.
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  })
);
var cors = require("cors");
let io = require("socket.io")(http, {
  cors: {
    credentials: true, // This is important.
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS" + origin));
    },
  },
});

const clientBuildPath = path.join(__dirname, "..", "..", "client", "build");
// Check if the clientBuildPath exists
if (fs.existsSync(clientBuildPath)) {
  // Serve react
  app.use(express.static(clientBuildPath));
} else {
  // If not, serve a static page
  app.use(
    express.static(path.join(__dirname, "..", "static", "pages", "no-client"))
  );
}

app.use(express.static(path.join(__dirname, "..", "..", "client", "public")));
app.use("/manifest.json", (req, res, next) => {
  res.sendFile(
    path.join(__dirname, "..", "..", "client", "public", "manifest.json")
  );
});
app.use((req, res, next) => {
  res.sendFile(
    path.join(__dirname, "..", "..", "client", "build", "index.html")
  );
});

http.listen(port, () => {
  async function main() {
    const uri =
      "mongodb://root:ceYbc6VDwf2K3p38Y648Tm6PuDJVaBvL@192.168.0.2:29019/FrontBase?authSource=admin&replicaSet=replicaset&readPreference=primaryPreferred&directConnection=true&ssl=false&appname=Frontbase%20Server";
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
          const interactor = new Interactor(socket, db);
          // Todo delete listeners on disconnect
        });
      }
    } catch (e) {
      console.error("Error state", e);
    }
  }
  main();
});

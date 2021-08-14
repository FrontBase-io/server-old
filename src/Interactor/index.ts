import { ChangeStream } from "mongodb";
import { getObjects } from "../Utils/Functions/Data";
import {
  checkUserToken,
  comparePasswordToHash,
  getUserToken,
} from "../Utils/Functions/UserSecurity";
import { DBCollectionsType, ObjectType, UserObjectType } from "../Utils/Types";
const uniqid = require("uniqid");

export default class Interactor {
  // Connection with the user
  socket;
  // The database
  db;
  // Collections
  collections: DBCollectionsType = {
    models: null,
    objects: null,
  };
  // Current user information
  user: UserObjectType;
  // Security level
  // 0 = Signed out
  // 1 = Signed in (username / password)
  // 2 = Basic 2fa (OTP)
  // 3 = Basic 2fa + email performed in this session
  // 4 = Advanced 2fa (security key)
  securityLevel = 0;
  // Permissions
  permissions = ["everybody"];
  // Realtime data listeners
  objectListeners = {};
  modelListeners = {};
  changeStreams: ChangeStream[] = [];

  constructor(socket, db) {
    this.socket = socket;
    this.db = db;
    this.collections = {
      models: db.collection("models"),
      objects: db.collection("objects"),
    };

    // Change stream
    this.changeStreams[0] = this.collections.objects.watch();
    this.changeStreams[0].on("change", async (change) => {
      const object = (await this.collections.objects.findOne({
        ...change.documentKey,
      })) as ObjectType;

      // Loop through all the listeners for this model
      // Use a filterCache to save a query if the filter is the same
      const filterCache = {};

      (this.objectListeners[object.meta.model] || []).map((listener) => {
        if (filterCache[listener.query]) {
          // Answer with cache
          this.socket.emit(
            `receive ${listener.key}`,
            filterCache[listener.query]
          );
        } else {
          // Perform query
          getObjects(this.collections, object.meta.model, listener.filter).then(
            ({ objects }) => {
              this.socket.emit(`receive ${listener.key}`, objects);

              // Cache the result
              filterCache[listener.filter] = objects;
            }
          );
        }
      });
    });
    this.changeStreams[1] = this.collections.models.watch();
    this.changeStreams[1].on("change", (next) => {
      console.log("Model change", next);
    });

    /* systemGetObjects */
    this.socket.on("systemGetsObjects", async (modelKey, filter, callback) => {
      // Respond directly with the initial results
      getObjects(this.collections, modelKey, filter).then(
        ({ objects, model }) => {
          const key = uniqid();
          callback({ success: true, key, objects });

          // Also register it as a listener for live data
          this.objectListeners[model.key] =
            this.objectListeners[modelKey] || [];
          this.objectListeners[model.key].push({ filter, key });
        },
        (reason) => {
          callback({ success: false, reason });
        }
      );
    });

    /* Get token */
    this.socket.on("getToken", async (up, callback) => {
      // Get the user
      const user = (await this.collections.objects.findOne({
        "meta.model": "user",
        username: up.username,
      })) as UserObjectType;

      // Check if the submitted password is the right one
      if (comparePasswordToHash(user.password, up.password)) {
        const token = getUserToken(user);
        callback({ success: true, token });
      } else {
        callback({ success: false, reason: "wrong-password" });
      }
    });

    /* Token log in*/
    this.socket.on(
      "logIn",
      async (args: { username: string; token: string }, callback) => {
        // Get the user
        const user = (await this.collections.objects.findOne({
          "meta.model": "user",
          username: args.username,
        })) as UserObjectType;

        if (checkUserToken(args.token, user)) {
          // Callback (without password hash)
          delete user.password;
          callback({ success: true, user });

          // Upgrade current session's information
          console.log(`${user.username} is online!`);

          this.user = user;
          this.securityLevel = 1;
          this.permissions.push("users");
        } else {
          callback({ success: false, reason: "wrong-token" });
        }
      }
    );

    /* Up check */
    this.socket.on("alive?", async (callback) => {
      callback({ success: true });
    });
  }
}

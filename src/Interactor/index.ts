import { map } from "lodash";
import { ChangeStream, ObjectId } from "mongodb";
import Process from "../Process/process";
import {
  createModel,
  createObject,
  deleteObject,
  getModel,
  getModels,
  getObject,
  getObjects,
  updateModel,
  updateObject,
} from "../Utils/Functions/Data";
import {
  checkUserToken,
  comparePasswordToHash,
  getUserToken,
} from "../Utils/Functions/UserSecurity";
import {
  DBCollectionsType,
  ModelType,
  ObjectType,
  ProcessObjectType,
  UserObjectType,
} from "../Utils/Types";
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
    usersettings: null,
    systemsettings: null,
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
  modelListeners = [];
  changeStreams: ChangeStream[] = [];

  constructor(socket, db) {
    this.socket = socket;
    this.db = db;
    this.collections = {
      models: db.collection("models"),
      objects: db.collection("objects"),
      usersettings: db.collection("usersettings"),
      systemsettings: db.collection("systemsettings"),
    };

    // Change stream
    this.changeStreams[0] = this.collections.objects.watch([], {
      fullDocument: "updateLookup",
    });
    this.changeStreams[0].on("change", async (change) => {
      const object = (await this.collections.objects.findOne({
        ...change.documentKey,
      })) as ObjectType;

      // Loop through all the listeners for this model
      // Use a filterCache to save a query if the filter is the same
      if (change.operationType === "delete") {
        // If this is delete we don't have a model anymore, re-fire all triggers.
        map(
          this.objectListeners,
          (modelObjectListener: { [key: string]: any }[]) =>
            modelObjectListener.map((listener) => {
              // Perform query
              listener.dbAction().then((result) => {
                this.socket.emit(`receive ${listener.key}`, result);
              });
            })
        );
      } else {
        // For any other operation we can just trigger the affected objects.
        (this.objectListeners[object.meta.model] || []).map((listener) => {
          // Perform query
          listener.dbAction().then((result) => {
            this.socket.emit(`receive ${listener.key}`, result);
          });
        });
      }
    });
    this.changeStreams[1] = this.collections.models.watch();
    this.changeStreams[1].on("change", async (change) => {
      // Loop through all the listeners for this model
      // Use a filterCache to save a query if the filter is the same
      const filterCache = {};

      this.modelListeners.map((listener) => {
        if (filterCache[listener.query]) {
          // Answer with cache
          this.socket.emit(
            `receive ${listener.key}`,
            filterCache[listener.query]
          );
        } else {
          // Perform query
          listener.dbAction().then((result) => {
            this.socket.emit(`receive ${listener.key}`, result);

            // Cache the result
            filterCache[listener.filter] = result;
          });
        }
      });
    });

    /* Get user settings */
    this.socket.on("turnObjectIdIntoModelKey", async (_id, callback) => {
      const object = await this.collections.objects.findOne({
        _id: new ObjectId(_id),
      });

      callback({ success: true, modelKey: object.meta.model });
    });

    /* Get user settings */
    this.socket.on("getUserSetting", async (key, callback) => {
      const setting = await this.collections.usersettings.findOne({
        user: this.user._id.toString(),
        key,
      });
      if (setting) {
        callback({ success: true, value: setting.value });
      } else {
        callback({ success: false, reason: "no-such-setting" });
      }
    });

    /* Get system settings */
    this.socket.on("getSystemSetting", async (key, callback) => {
      const setting = await this.collections.systemsettings.findOne({
        key,
      });
      if (setting) {
        callback({ success: true, value: setting.value });
      } else {
        callback({ success: false, reason: "no-such-setting" });
      }
    });

    /* updateModel */
    this.socket.on("updateModel", async (model, callback) => {
      updateModel(this, model).then(
        () => callback({ success: true }),
        (reason) => callback({ success: false, reason })
      );
    });

    /* getModels */
    this.socket.on("getModels", async (filter, callback) => {
      // Respond directly with the initial results
      getModels(this, filter).then(({ models }) => {
        const key = uniqid();
        callback({ success: true, key, models });

        // Also register it as a listener for live data
        this.modelListeners.push({
          filter,
          key,
          dbAction: async () => getModels(this, filter),
        });
      });
    });

    /* getModel */
    this.socket.on("getModel", async (modelKey: string, callback) => {
      // Respond directly with the initial results
      getModel(this, modelKey).then(({ model }) => {
        const requestKey = uniqid();
        callback({ success: true, key: requestKey, model });

        // Also register it as a listener for live data
        this.modelListeners.push({
          $or: [{ key: modelKey }, { key_plural: modelKey }],
          key: requestKey,
          dbAction: async () => getModel(this, modelKey),
        });
      });
    });

    /* createModel */
    this.socket.on("createModel", async (model: ModelType, callback) => {
      // Respond directly with the initial results
      createModel(this, model).then(
        (model) => callback({ success: true, model }),
        (reason) => callback({ success: false, reason })
      );
    });

    /* Create Object */
    this.socket.on("createObject", async (modelKey, newObject, callback) => {
      createObject(this, modelKey, newObject).then(
        (result) => callback({ success: true, result }),
        (reason) => callback({ success: false, reason })
      );
    });

    /* Update Object */
    this.socket.on(
      "updateObject",
      async (_id: string, fieldsToUpdate, callback) => {
        updateObject(this, _id, fieldsToUpdate).then(
          (result) => callback({ success: true, result }),
          (reason) => callback({ success: false, reason })
        );
      }
    );

    /* Delete Object */
    this.socket.on(
      "deleteObject",
      async (modelKey: string, objectId: string, callback) => {
        deleteObject(this, modelKey, objectId).then(
          (result) => callback({ success: true, result }),
          (reason) => callback({ success: false, reason })
        );
      }
    );

    /* getObjects */
    this.socket.on("getObjects", async (modelKey, filter, callback) => {
      // Respond directly with the initial results
      getObjects(this, modelKey, filter).then(
        ({ objects, model }) => {
          const key = uniqid();
          callback({ success: true, key, objects });

          // Also register it as a listener for live data
          this.objectListeners[model.key] =
            this.objectListeners[modelKey] || [];
          this.objectListeners[model.key].push({
            filter,
            key,
            dbAction: async () => getObjects(this, modelKey, filter),
          });
        },
        (reason) => {
          callback({ success: false, reason });
        }
      );
    });

    /* getObject */
    // Convenience function to get just one object instead of an array
    this.socket.on("getObject", async (modelKey, filter, callback) => {
      // Respond directly with the initial results
      getObject(this, modelKey, filter).then(
        ({ object, model }) => {
          const key = uniqid();
          callback({ success: true, key, object });

          // Also register it as a listener for live data
          this.objectListeners[model.key] =
            this.objectListeners[modelKey] || [];
          this.objectListeners[model.key].push({
            filter,
            key,
            dbAction: async () => getObject(this, modelKey, filter),
          });
        },
        (reason) => {
          callback({ success: false, reason });
        }
      );
    });

    /* Perform actions */
    this.socket.on(
      "executeSingleAction",
      async (actionId: string, object: ObjectType) => {
        const processObject = (await this.collections.objects.findOne({
          _id: new ObjectId(actionId),
          "meta.model": "process",
        })) as ProcessObjectType;
        const trigger = processObject.triggers.singleAction[0];

        const process = new Process(processObject);

        const result = await process.execute(trigger, {
          input: object,
        });
        console.log(result);
      }
    );

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

          // Figure out all the user's permissions
          user.roles.map(async (roleKey) => {
            const role = await this.collections.objects.findOne({
              _id: new ObjectId(roleKey),
            });
            role?.permissions.map(async (permissionKey) => {
              const permission = await this.collections.objects.findOne({
                _id: new ObjectId(permissionKey),
              });
              if (!this.permissions.includes(permission?.name)) {
                this.permissions.push(permission?.name);
              }
            });
          });
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

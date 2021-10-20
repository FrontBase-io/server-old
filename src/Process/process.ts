import { cloneDeep, findLast, map } from "lodash";
import { updateObject } from "../Utils/Functions/Data";
import Formula from "../formulas";
import {
  ObjectType,
  ProcesLogicStepItemType,
  ProcessObjectType,
  ProcessTriggerType,
} from "../Utils/Types";
import Interactor from "../Interactor";

export default class Process {
  // The process from the database
  processObject: ProcessObjectType;
  // The trigger that has been fired
  trigger: ProcessTriggerType;
  // Variables
  vars = {};
  interactor: Interactor;

  constructor(po, interactor: Interactor) {
    this.processObject = po;
    this.interactor = interactor;
  }

  // Execute process
  execute = (
    trigger: ProcessTriggerType,
    inputArgs: {
      newObject?: ObjectType | ObjectType[];
      oldObject?: ObjectType | ObjectType[];
      input?: ObjectType | ObjectType[];
    }
  ) =>
    new Promise<any>(async (resolve, reject) => {
      this.trigger = trigger;
      console.log(
        `🤖 Process: ${trigger.label} for ${this.processObject.name} fired!`
      );

      // Map the input vars
      if (trigger.newObject && inputArgs.newObject)
        this.vars[trigger.newObject] =
          this.processObject.variables[trigger.newObject].type === "objects"
            ? [inputArgs.newObject]
            : inputArgs.newObject;
      if (trigger.oldObject && inputArgs.oldObject)
        this.vars[trigger.oldObject] =
          this.processObject.variables[trigger.oldObject].type === "objects"
            ? [inputArgs.oldObject]
            : inputArgs.oldObject;
      if (trigger.input && inputArgs.input)
        this.vars[trigger.input] =
          this.processObject.variables[trigger.input].type === "objects"
            ? [inputArgs.input]
            : inputArgs.input;

      // Find node to execute along the first edge
      let currentEdge = findLast(
        this.processObject.logic,
        //@ts-ignore
        (o) => o.source === "input"
      );
      let currentNode = findLast(
        this.processObject.logic,
        //@ts-ignore
        (o) => o.id === currentEdge.target
      );
      while (currentNode.type !== "output") {
        await this.executeNode(currentNode);
        currentEdge = findLast(
          this.processObject.logic,
          //@ts-ignore
          (o) => o.source === currentNode.id
        );
        currentNode = findLast(
          this.processObject.logic,
          //@ts-ignore
          (o) => o.id === currentEdge.target
        );
        currentNode;
      }

      if (trigger.output) {
        resolve(this.vars[trigger.output]);
      } else {
        resolve("no-output");
      }
    });

  // Perform step
  executeNode = (node: ProcesLogicStepItemType) =>
    new Promise<void>(async (resolve, reject) => {
      switch (node.data.type) {
        case "assign_values":
          //@ts-ignore
          await Object.keys(node.data.args).reduce(async (prev, key) => {
            await prev;

            let value = node.data.args[key];

            // Process any potential formulas
            //@ts-ignore
            await Object.keys(value).reduce(async (prev, fieldKey) => {
              await prev;

              const fieldValue = value[fieldKey];
              if (fieldValue["___form"]) {
                // Found formula, process it!
                const formula = new Formula(fieldValue["___form"]);
                await formula.onParsed;

                if (this.processObject.variables[key].type === "objects") {
                  // This variable is an array, so process the formula for every item in the array
                  let pos = 0;
                  value = [];
                  await this.vars[key].reduce(async (prev, varInArray) => {
                    await prev;

                    // Replace objects var's [{obj}] with {obj} so it can be processed as if though it was a single object
                    const localVars = cloneDeep(this.vars);
                    localVars[key] = varInArray;

                    // Execute formula for localvar
                    value[pos] = value[pos] || {};
                    value[pos][fieldKey] = await formula.parse(localVars);

                    pos++;
                    return varInArray;
                  }, this.vars[key][0]);
                } else {
                  (value as object)[fieldKey] = await formula.parse(this.vars);
                }
              } else {
                return fieldKey;
              }
            }, Object.keys(value)[0]);

            if (this.processObject.variables[key].type === "objects") {
              // Objects, loop through every object to assign the value

              let pos = 0;
              await this.vars[key].reduce(async (prev, curr) => {
                await prev;

                this.vars[key][pos] = {
                  ...this.vars[key][pos],
                  ...(value[pos] as object),
                };

                pos++;
                return curr;
              }, this.vars[key][0]);
            } else if (this.processObject.variables[key].type === "object") {
              this.vars[key] = {
                ...this.vars[key],
                ...(value as object),
              };
            }

            return key;
          }, Object.keys(node.data.args)[0]);

          resolve();
          break;
        case "update_objects":
          //@ts-ignore
          await node.data.args.toUpdate.reduce(async (prev, curr) => {
            await prev;

            if (this.vars[curr]) {
              if (this.processObject.variables[curr].type === "objects") {
                // Update an array of objects
                await this.vars[curr].reduce(async (prev, objToUpdate) => {
                  await prev;

                  await updateObject(
                    this.interactor,
                    objToUpdate._id,
                    objToUpdate
                  );

                  return objToUpdate;
                }, this.vars[curr][0]);
              } else {
                // Update an object
                await updateObject(
                  this.interactor,
                  this.vars[curr]._id,
                  this.vars[curr]
                );
              }
            } else {
              reject("var-not-found");
            }

            return curr;
          }, node.data.args.toUpdate[0]);
          resolve();
          break;
        default:
          console.log(`Unknown node type ${node.data.type}`);
          reject("unknown-node-type");
          break;
      }
    });
}

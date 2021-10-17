import { findLast, map } from "lodash";
import {
  ObjectType,
  ProcesLogicStepItemType,
  ProcessObjectType,
  ProcessTriggerType,
} from "../Utils/Types";

export default class Process {
  // The process from the database
  processObject: ProcessObjectType;
  // The trigger that has been fired
  trigger: ProcessTriggerType;
  // Variables
  vars = {};

  constructor(po) {
    this.processObject = po;
  }

  // Execute process
  execute = (
    trigger: ProcessTriggerType,
    inputArgs: {
      newObject?: ObjectType | ObjectType[];
      oldObject?: ObjectType | ObjectType[];
    }
  ) =>
    new Promise<any>(async (resolve, reject) => {
      // Account
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

      // Find node to execute along the first edge
      const startEdge = findLast(
        this.processObject.logic,
        //@ts-ignore
        (o) => o.source === "input"
      );
      const startNode = findLast(
        this.processObject.logic,
        //@ts-ignore
        (o) => o.id === startEdge.target
      );
      await this.executeNode(startNode);

      if (trigger.output) {
        resolve(this.vars[trigger.output]);
      } else {
        resolve("no-output");
      }
    });

  // Perform step
  executeNode = (node: ProcesLogicStepItemType) =>
    new Promise<void>((resolve, reject) => {
      switch (node.data.type) {
        case "assign_values":
          map(node.data.args, (value, key) => {
            if (this.processObject.variables[key].type === "objects") {
              // Objects, loop through every object to assign the value
              this.vars[key].map((obj, objIndex) => {
                this.vars[key][objIndex] = {
                  ...this.vars[key][objIndex],
                  ...(value as object),
                };
              });
            } else if (this.processObject.variables[key].type === "object") {
              this.vars[key] = {
                ...this.vars[key],
                ...(value as object),
              };
            }
          });
          resolve();
          break;
        default:
          console.log(`Unknown node type ${node.data.type}`);
          reject("unknown-node-type");
          break;
      }
    });
}

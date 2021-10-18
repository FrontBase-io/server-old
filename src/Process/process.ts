import { findLast, map } from "lodash";
import Formula from "../formulas";
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

            const value = node.data.args[key];

            // Process any potential formulas
            //@ts-ignore
            await Object.keys(value).reduce(async (prev, fieldKey) => {
              await prev;

              const fieldValue = value[fieldKey];
              if (fieldValue["___form"]) {
                // Found formula, process it!
                const formula = new Formula(fieldValue["___form"]);
                await formula.onParsed;
                (value as object)[fieldKey] = await formula.parse(this.vars);
              } else {
                return fieldKey;
              }
            }, Object.keys(value)[0]);

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

            return key;
          }, Object.keys(node.data.args)[0]);

          resolve();
          break;
        default:
          console.log(`Unknown node type ${node.data.type}`);
          reject("unknown-node-type");
          break;
      }
    });
}

import { Collection } from "mongodb";

/* Server technical types */
export interface DBCollectionsType {
  models: Collection;
  objects: Collection;
}

/* Model */
export interface ModelType {
  _id: string;
  key: string;
  key_plural: string;
  label: string;
  label_plural: string;
  app: string;
  locked?: Boolean;
  permissions: {
    create: string[];
    read: string[];
    read_own: string[];
    update: string[];
    update_own: string[];
    delete: string[];
    delete_own: string[];
  };
}

/* Object types */
export interface ObjectType {
  _id: string;
  meta: {
    model: string;
    createdOn: Date;
    lastModifiedOn: Date;
    createdBy: string;
    lastModifiedBy: string;
    owner: string;
    team?: string;
  };
  [key: string]: any;
}

export interface UserObjectType extends ObjectType {
  username: string;
}

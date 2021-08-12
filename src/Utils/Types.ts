/* Object types */
export interface ObjectType {
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

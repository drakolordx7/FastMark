export type Proposal =
  | {
      type: "move_to_collection";
      collectionName: string;
      bookmarkIds: string[];
      createIfMissing?: boolean;
    }
  | {
      type: "add_tag";
      tag: string;
      bookmarkIds: string[];
    }
  | {
      type: "set_favorite";
      bookmarkIds: string[];
      value: boolean;
    }
  | {
      type: "set_read_later";
      bookmarkIds: string[];
      value: boolean;
    };

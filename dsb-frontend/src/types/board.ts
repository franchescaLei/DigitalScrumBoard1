export type ActiveBoard = {
  sprintID: number;
  sprintName: string;
};

export type WorkItemBoardDto = {
  workItemID: number;
  title: string;
  status: string;
  typeName?: string | null;
  priority?: string | null;
  assignedUserID: number | null;
  assignedUserName?: string | null;
  commentCount: number;
};

export type BoardResponse = {
  sprintID: number;
  sprintName: string;
  sprintManagerName?: string | null;
  todo: WorkItemBoardDto[];
  ongoing: WorkItemBoardDto[];
  forChecking: WorkItemBoardDto[];
  completed: WorkItemBoardDto[];
};

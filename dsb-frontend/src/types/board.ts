export type ActiveBoard = {
  sprintID: number;
  sprintName: string;
};

export type WorkItemBoardDto = {
  workItemID: number;
  title: string;
  status: string;
  assignedUserID: number | null;
};

export type BoardResponse = {
  sprintID: number;
  sprintName: string;
  todo: WorkItemBoardDto[];
  ongoing: WorkItemBoardDto[];
  forChecking: WorkItemBoardDto[];
  completed: WorkItemBoardDto[];
};
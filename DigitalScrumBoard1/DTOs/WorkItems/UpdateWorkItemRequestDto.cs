using System.ComponentModel.DataAnnotations;

namespace DigitalScrumBoard1.DTOs.WorkItems;

public sealed class UpdateWorkItemRequestDto
{
    [MaxLength(200)]
    public string? Title { get; set; }

    [MaxLength(2000)]
    public string? Description { get; set; }

    [MaxLength(20)]
    public string? Priority { get; set; }

    public int? ParentWorkItemID { get; set; }

    public int? TeamID { get; set; }

    public int? AssignedUserID { get; set; }

    public DateOnly? DueDate { get; set; }
}
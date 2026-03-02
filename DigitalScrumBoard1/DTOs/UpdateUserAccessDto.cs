using System.ComponentModel.DataAnnotations;

namespace DigitalScrumBoard1.Dtos
{
    public sealed class UpdateUserAccessDto
    {
        // Nullable = optional (partial update)
        [Range(1, int.MaxValue)]
        public int? RoleID { get; set; }

        [Range(1, int.MaxValue)]
        public int? TeamID { get; set; }
    }
}
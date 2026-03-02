using System.ComponentModel.DataAnnotations;

namespace DigitalScrumBoard1.Dtos
{
    public sealed class ResetPasswordRequestDto
    {
        [Required]
        public string Token { get; set; } = string.Empty;

        [Required]
        [StringLength(128, MinimumLength = 8)]
        public string NewPassword { get; set; } = string.Empty;
    }
}
using System.ComponentModel.DataAnnotations;

namespace DigitalScrumBoard1.Dtos
{
    public sealed class ForgotPasswordRequestDto
    {
        [Required]
        [EmailAddress]
        [StringLength(100)]
        public string EmailAddress { get; set; } = string.Empty;
    }
}
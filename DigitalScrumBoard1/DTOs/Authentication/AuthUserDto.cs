namespace DigitalScrumBoard1.DTOs.Authentication
{
    public sealed class AuthUserDto
    {
        public int UserID { get; set; }
        public string EmailAddress { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public int RoleID { get; set; }
        public string RoleName { get; set; } = string.Empty;

        // ✅ was int
        public int? TeamID { get; set; }
    }
}
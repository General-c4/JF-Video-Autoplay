using System.Reflection;
using Jellyfin.Plugin.VideoAutoplay.Controllers;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace Jellyfin.Plugin.VideoAutoplay.Tests;

public sealed class AuthorizationTests
{
    private static readonly string[] AdministrativeActions =
    {
        nameof(VaController.YtDirect),
        nameof(VaController.Info),
        nameof(VaController.Probe),
        nameof(VaController.InjectNow),
        nameof(VaController.RemoveNow),
        nameof(VaController.GetConf),
        nameof(VaController.SaveConf)
    };

    [Theory]
    [MemberData(nameof(AdminActions))]
    public void AnonymousAccessIsRejectedByElevationPolicy(string methodName)
        => AssertRequiresElevation(methodName);

    [Theory]
    [MemberData(nameof(AdminActions))]
    public void NormalUserAccessIsRejectedByElevationPolicy(string methodName)
        => AssertRequiresElevation(methodName);

    [Theory]
    [MemberData(nameof(AdminActions))]
    public void AdministratorAccessUsesJellyfinElevationPolicy(string methodName)
        => AssertRequiresElevation(methodName);

    [Theory]
    [InlineData(nameof(VaController.ConfigJs))]
    [InlineData(nameof(VaController.ConfigJson))]
    [InlineData(nameof(VaController.Loader))]
    [InlineData(nameof(VaController.MediaCacheJs))]
    [InlineData(nameof(VaController.RuntimeJs))]
    [InlineData(nameof(VaController.MainJs))]
    [InlineData(nameof(VaController.HlsJs))]
    public void OnlyStaticClientAssetsAllowAnonymousAccess(string methodName)
    {
        var method = typeof(VaController).GetMethod(methodName)!;
        Assert.NotNull(method.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(method.GetCustomAttribute<AuthorizeAttribute>());
    }

    public static TheoryData<string> AdminActions()
    {
        var data = new TheoryData<string>();
        foreach (var action in AdministrativeActions)
        {
            data.Add(action);
        }

        return data;
    }

    private static void AssertRequiresElevation(string methodName)
    {
        var method = typeof(VaController).GetMethod(methodName)!;
        var authorize = method.GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(Policies.RequiresElevation, authorize.Policy);
        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
    }
}
